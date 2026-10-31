using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Godot;
using DustRoad.Core;
using DustRoad.Gfx;

namespace DustRoad.World.Places;

// The places along the road (the homestead, houses, and the rest as they are modelled): laid out
// on worker threads as the camera nears them, their models (BuildingLibrary) loading in the
// background, then put into the scene a building a frame with their colliders, door leaves,
// footings where the land falls away under them and fences along their yards; dropped again far
// behind. A port of the manager in web/src/world/poi.js. Shows in the editor too.
[Tool]
public partial class PlaceStreamer : Node3D
{
	// what the player walks on (as the bridges)
	public const uint StructureLayer = 1u << 1;
	const float FenceSection = 2.5f;

	[Export] public int Seed = 1234;
	[Export] public float LoadRadius = 700;
	[Export] public float UnloadRadius = 950;
	[Export] public float EditorRadius = 300;

	sealed class Laid
	{
		public int K;
		public Poi Poi;
		public Layouts.Plan Plan;
		// per entry, the footings under it; the fence sections (place frame, length or 0: a post)
		public List<MeshBuilder> Footings;
		public List<(Transform3D xf, float len)> Fence;
		public float Snow;
	}

	sealed class Place
	{
		public Poi Poi;
		public Node3D Root;
		public StaticBody3D Body;
		// what is still to be put in: each returns false while it waits (for its model)
		public readonly Queue<Func<bool>> Pending = new();
	}

	readonly Dictionary<int, Place> _loaded = new();
	readonly HashSet<int> _inflight = new();
	readonly ConcurrentQueue<Laid> _ready = new();
	ThreadLocal<WorldGen> _gens;
	WorldGen _gen;
	int _genSeed = int.MinValue;

	// nothing near waiting to be built (pictures wait for it)
	public bool AllBuilt { get; private set; }
	// everything at once, models loaded on the spot (pictures: a frame takes seconds there)
	public bool Instant;

	public override void _Ready() => WorldOrigin.Shifted += OnOriginShifted;
	public override void _ExitTree() => WorldOrigin.Shifted -= OnOriginShifted;

	void OnOriginShifted(double dx, double dz)
	{
		foreach (var p in _loaded.Values) p.Root.Position = WorldOrigin.ToScene(p.Poi.X, p.Poi.Y, p.Poi.Z);
	}

	Camera3D FocusCamera()
	{
#if TOOLS
		if (Engine.IsEditorHint()) return EditorInterface.Singleton.GetEditorViewport3D(0)?.GetCamera3D();
#endif
		return GetViewport()?.GetCamera3D();
	}

	public override void _Process(double delta)
	{
		if (_genSeed != Seed)
		{
			foreach (var p in _loaded.Values) p.Root.QueueFree();
			_loaded.Clear();
			_gen = new WorldGen(Seed);
			int seed = Seed;
			_gens = new ThreadLocal<WorldGen>(() => new WorldGen(seed));
			_genSeed = Seed;
		}
		var cam = FocusCamera();
		if (cam == null) return;
		var (gx, gz) = WorldOrigin.ToWorld(cam.GlobalPosition);
		float load = Engine.IsEditorHint() ? EditorRadius : LoadRadius;
		float unload = Engine.IsEditorHint() ? EditorRadius * 1.3f : UnloadRadius;
		int k0 = (int)Math.Round(gz / WorldGen.PoiSpacing);
		bool waiting = false;
		for (int k = k0 - 2; k <= k0 + 2; k++)
		{
			var poi = _gen.PoiSlot(k);
			if (poi == null || _loaded.ContainsKey(k) || _inflight.Contains(k)) continue;
			if (Dist(poi, gx, gz) > load) continue;
			Start(k, poi);
			waiting = true;
		}
		List<int> drop = null;
		foreach (var (k, p) in _loaded)
			if (Dist(p.Poi, gx, gz) > unload) (drop ??= new()).Add(k);
		if (drop != null)
			foreach (int k in drop)
			{
				_loaded[k].Root.QueueFree();
				_loaded.Remove(k);
			}
		// one piece of work a frame: the next thing waiting in a place, or else a newly laid place
		bool busy = false;
		do
		{
			busy = false;
			foreach (var p in _loaded.Values)
				while (p.Pending.Count > 0)
				{
					busy = true;
					if (!p.Pending.Peek()()) break;
					p.Pending.Dequeue();
					if (!Instant) break;
				}
			if (busy && !Instant)
			{
				AllBuilt = false;
				return;
			}
			if (_ready.TryDequeue(out var r))
			{
				_inflight.Remove(r.K);
				if (!_loaded.ContainsKey(r.K) && Dist(r.Poi, gx, gz) <= unload) Assemble(r);
				busy = true;
				if (!Instant)
				{
					AllBuilt = false;
					return;
				}
			}
		} while (Instant && busy);
		AllBuilt = !waiting && _inflight.Count == 0 && !busy;
	}

	static double Dist(Poi p, double x, double z) => Math.Sqrt((p.X - x) * (p.X - x) + (p.Z - z) * (p.Z - z));

	// Where a point of the place's frame lies in the world.
	static (double x, double z) WorldAt(Poi poi, float x, float z)
	{
		double cr = Math.Cos(poi.Rot), sr = Math.Sin(poi.Rot);
		return (poi.X + x * cr + z * sr, poi.Z - x * sr + z * cr);
	}

	static Transform3D EntryXf(Layouts.Entry e) => new(new Basis(Vector3.Up, e.Rot), new Vector3(e.X, e.Y, e.Z));

	void Start(int k, Poi poi)
	{
		_inflight.Add(k);
		var gens = _gens;
		Task.Run(() =>
		{
			var laid = new Laid { K = k, Poi = poi, Footings = new(), Fence = new() };
			try
			{
				var gen = gens.Value;
				var rnd = Hash.Mulberry32((uint)poi.Seed);
				laid.Plan = Layouts.For(poi, rnd) ?? new Layouts.Plan();
				foreach (var e in laid.Plan.Entries)
				{
					if (e.Snap)
					{
						var (wx, wz) = WorldAt(poi, e.X, e.Z);
						e.Y = (float)(gen.Height(wx, wz) - poi.Y);
					}
					laid.Footings.Add(Footings(gen, poi, e, BuildingLibrary.GetMeta(e.Model)));
				}
				foreach (var line in laid.Plan.Fences) FenceRun(gen, poi, line, laid.Fence);
				laid.Snow = (float)Math.Clamp(gen.SnowAt(poi.X, poi.Z), 0, 1);
			}
			catch (Exception ex)
			{
				GD.PushError($"place {k} ({poi.Type}) failed: {ex}");
				laid.Plan = new Layouts.Plan();
				laid.Footings.Clear();
				laid.Fence.Clear();
			}
			_ready.Enqueue(laid);
		});
	}

	// Where the land falls away under a building (the edge of its pad, a slope), a concrete footing
	// runs down from each floor, slab and post to the real ground.
	static MeshBuilder Footings(WorldGen gen, Poi poi, Layouts.Entry e, BuildingLibrary.Meta meta)
	{
		var mb = new MeshBuilder();
		var exf = EntryXf(e);
		foreach (var c in meta.Colliders)
		{
			float bottom = c.C.Y - c.H.Y;
			if (bottom > 0.5f || c.RotX != 0 || c.Surface == "roof") continue;
			if (c.H.X * c.H.Z * 4 < 0.03f) continue;
			var basis = new Basis(Vector3.Up, c.RotY);
			double low = double.MaxValue;
			foreach (var (ax, az) in new[] { (0f, 0f), (-c.H.X, -c.H.Z), (c.H.X, -c.H.Z), (-c.H.X, c.H.Z), (c.H.X, c.H.Z) })
			{
				var p = exf * (c.C + basis * new Vector3(ax, 0, az));
				var (wx, wz) = WorldAt(poi, p.X, p.Z);
				low = Math.Min(low, gen.Height(wx, wz) - poi.Y - e.Y);
			}
			float gap = bottom - (float)low;
			if (gap < 0.08f) continue;
			float depth = gap + 0.35f;
			var centre = new Vector3(c.C.X, bottom - depth / 2 + 0.01f, c.C.Z);
			mb.Box(exf * new Transform3D(basis, centre), new Vector3(Math.Max(0.05f, c.H.X - 0.02f), depth / 2, Math.Max(0.05f, c.H.Z - 0.02f)));
		}
		return mb;
	}

	// Fence sections along a line, each stood on the land at its post.
	static void FenceRun(WorldGen gen, Poi poi, Vector2[] line, List<(Transform3D, float)> into)
	{
		for (int i = 0; i < line.Length - 1; i++)
		{
			var a = line[i];
			var b = line[i + 1];
			float L = (b - a).Length();
			int n = Math.Max(1, (int)Math.Round(L / FenceSection));
			float rot = Mathf.Atan2(-(b.Y - a.Y), b.X - a.X);
			for (int k = 0; k <= n; k++)
			{
				var p = a.Lerp(b, k / (float)n);
				var (wx, wz) = WorldAt(poi, p.X, p.Y);
				float y = (float)(gen.Height(wx, wz) - poi.Y);
				// (the last a post alone)
				into.Add((new Transform3D(new Basis(Vector3.Up, rot), new Vector3(p.X, y, p.Y)), k < n ? L / n : 0));
			}
		}
	}

	void Assemble(Laid r)
	{
		var poi = r.Poi;
		var root = new Node3D { Name = $"Place {r.K} {poi.Type}", Position = WorldOrigin.ToScene(poi.X, poi.Y, poi.Z), Rotation = new Vector3(0, (float)poi.Rot, 0) };
		AddChild(root);
		var body = new StaticBody3D { Name = "Colliders", CollisionLayer = StructureLayer, CollisionMask = 0 };
		root.AddChild(body);
		var place = new Place { Poi = poi, Root = root, Body = body };
		_loaded[r.K] = place;
		for (int i = 0; i < r.Plan.Entries.Count; i++)
		{
			var e = r.Plan.Entries[i];
			var footing = r.Footings[i];
			BuildingLibrary.Request(e.Model);
			place.Pending.Enqueue(() =>
			{
				if (!Instant && !BuildingLibrary.IsReady(e.Model)) return false;
				BuildEntry(place, e, footing, r.Snow);
				return true;
			});
		}
		if (r.Fence.Count > 0)
		{
			BuildingLibrary.Request("fence");
			BuildingLibrary.Request("fence_post");
			place.Pending.Enqueue(() =>
			{
				if (!Instant && (!BuildingLibrary.IsReady("fence") || !BuildingLibrary.IsReady("fence_post"))) return false;
				foreach (var (xf, len) in r.Fence)
				{
					var n = BuildingLibrary.Instantiate(len > 0 ? "fence" : "fence_post", 0.6f, r.Snow);
					n.Transform = len > 0 ? xf.ScaledLocal(new Vector3(len / FenceSection, 1, 1)) : xf;
					place.Root.AddChild(n);
					if (len > 0)
						body.AddChild(new CollisionShape3D { Shape = new BoxShape3D { Size = new Vector3(len, 1.2f, 0.12f) }, Transform = xf * new Transform3D(Basis.Identity, new Vector3(len / 2, 0.6f, 0.03f)) });
				}
				return true;
			});
		}
	}

	// One building of a place: its model, colliders and footings.
	void BuildEntry(Place place, Layouts.Entry e, MeshBuilder footing, float snow)
	{
		var exf = EntryXf(e);
		var node = BuildingLibrary.Instantiate(e.Model, e.Age, snow);
		node.Transform = exf;
		place.Root.AddChild(node);
		foreach (var c in BuildingLibrary.GetMeta(e.Model).Colliders)
		{
			var basis = Basis.FromEuler(new Vector3(c.RotX, c.RotY, 0), EulerOrder.Yxz);
			place.Body.AddChild(new CollisionShape3D
			{
				Shape = new BoxShape3D { Size = new Vector3(Math.Max(0.02f, c.H.X * 2), Math.Max(0.02f, c.H.Y * 2), Math.Max(0.02f, c.H.Z * 2)) },
				Transform = exf * new Transform3D(basis, c.C),
			});
		}
		if (footing.VertexCount > 0)
		{
			var mesh = footing.ToMesh();
			mesh.SurfaceSetMaterial(0, BuildingMaterials.Get("concrete"));
			var mi = new MeshInstance3D { Name = "Footings", Mesh = mesh };
			mi.SetInstanceShaderParameter("age", e.Age);
			mi.SetInstanceShaderParameter("snow", snow);
			place.Root.AddChild(mi);
		}
	}
}
