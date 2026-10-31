using System;
using System.Collections.Generic;
using Godot;
using DustRoad.Core;
using DustRoad.Gfx;

namespace DustRoad.World;

// Bridges where Route 9 crosses a river or a dry wash: a concrete deck that follows the road's own
// profile, parapets with steel rails, piers standing in the water, abutments into the banks, and on
// wide northern rivers a steel through-truss. Colliders for the deck and parapets. A port of
// web/src/world/bridges.js.
[Tool]
public partial class BridgeStreamer : Node3D
{
	const double Range = 1300;

	[Export] public Material Concrete;
	[Export] public Material Steel;
	[Export] public Material Paint;
	[Export] public Material PaintNorth;
	[Export] public int Seed = 1234;

	readonly Dictionary<int, (Node3D root, double ox, double oz)> _items = new();
	WorldGen _gen;
	int _genSeed = int.MinValue;
	double _acc = 1;

	public override void _Ready() => WorldOrigin.Shifted += OnOriginShifted;
	public override void _ExitTree() => WorldOrigin.Shifted -= OnOriginShifted;

	void OnOriginShifted(double dx, double dz)
	{
		foreach (var (root, ox, oz) in _items.Values) root.Position = WorldOrigin.ToScene(ox, 0, oz);
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
			foreach (var it in _items.Values) it.root.QueueFree();
			_items.Clear();
			_gen = new WorldGen(Seed);
			_genSeed = Seed;
		}
		_acc += delta;
		if (_acc < 0.5) return;
		_acc = 0;
		var cam = FocusCamera();
		if (cam == null) return;
		var (_, pz) = WorldOrigin.ToWorld(cam.GlobalPosition);
		var want = new HashSet<int>();
		foreach (var r in _gen.RiversNear(pz, 1).ToArray())
		{
			if (Math.Abs(r.Zr - pz) > Range) continue;
			want.Add(r.K);
			if (_items.ContainsKey(r.K)) continue;
			double ox = _gen.RoadX(r.Zr), oz = r.Zr;
			var root = Build(_gen, r);
			root.Name = "Bridge " + r.K;
			root.Position = WorldOrigin.ToScene(ox, 0, oz);
			AddChild(root);
			_items[r.K] = (root, ox, oz);
		}
		List<int> drop = null;
		foreach (var k in _items.Keys)
			if (!want.Contains(k)) (drop ??= new()).Add(k);
		if (drop != null)
			foreach (var k in drop)
			{
				_items[k].root.QueueFree();
				_items.Remove(k);
			}
	}

	// A centre-line sample: position (local to the bridge), along the road, across it (to the right).
	public struct Station
	{
		public Vector3 P, T, S;
	}

	public static double Span(River r) => r.W + 12 + r.W * 0.6 + 4;
	public const float HalfWidth = (float)(WorldGen.RoadHalfWidth + WorldGen.RoadShoulder + 0.35);

	public static List<Station> Stations(WorldGen gen, River r)
	{
		double span = Span(r);
		double z0 = r.Zr - span, z1 = r.Zr + span;
		double ox = gen.RoadX(r.Zr), oz = r.Zr;
		const double step = 3;
		int n = (int)Math.Ceiling((z1 - z0) / step);
		var c = new List<Station>(n + 1);
		for (int i = 0; i <= n; i++)
		{
			double z = z0 + (z1 - z0) * i / n;
			var (dx, dz) = gen.RoadDir(z);
			c.Add(new Station
			{
				P = new Vector3((float)(gen.RoadX(z) - ox), (float)gen.RoadY(z), (float)(z - oz)),
				T = new Vector3((float)dx, 0, (float)dz),
				S = new Vector3((float)dz, 0, (float)-dx),
			});
		}
		return c;
	}

	// The bridge's three meshes (concrete, bare steel, painted steel) and its collider.
	public Node3D Build(WorldGen gen, River r)
	{
		var C = Stations(gen, r);
		int n = C.Count - 1;
		double ox = gen.RoadX(r.Zr), oz = r.Zr;
		float halfW = HalfWidth;
		var up = Vector3.Up;
		var cP = C.ConvertAll(c => c.P);
		var cS = C.ConvertAll(c => c.S);
		bool truss = r.W > 9.5 && !r.Dry && (r.Frozen || gen.DominantBiome(ox, oz) == Biome.Forest);
		var concrete = new MeshBuilder();
		var steel = new MeshBuilder();
		var paint = new MeshBuilder();
		Basis Frame(Station c) => new(c.S, up, c.T);

		// deck slab with fascia beams under its edges
		concrete.LoftRect(cP, cS, -halfW, halfW, -0.75f, -0.04f);
		concrete.LoftRect(cP, cS, -halfW - 0.05f, -halfW + 0.3f, -1.1f, -0.04f);
		concrete.LoftRect(cP, cS, halfW - 0.3f, halfW + 0.05f, -1.1f, -0.04f);
		// parapets: a concrete kerb, steel posts and two rails
		foreach (int sd in new[] { -1, 1 })
		{
			float a = sd * (halfW - 0.18f);
			concrete.LoftRect(cP, cS, a - 0.18f, a + 0.18f, -0.04f, 0.42f);
			foreach (var c in C) steel.Box(new Transform3D(Frame(c), c.P + c.S * a + up * (0.42f + 0.31f)), new Vector3(0.05f, 0.31f, 0.05f), 0.5f);
			foreach (float h in new[] { 0.72f, 1.0f }) steel.Tube(C.ConvertAll(c => c.P + c.S * a + up * h), 0.045f);
		}
		// piers in the channel, abutments into the banks
		const double pierEvery = 16;
		double len = 2 * Span(r);
		int np = Math.Max(1, (int)Math.Floor(len / pierEvery) - 1);
		for (int k = 1; k <= np; k++)
		{
			double t = k / (double)(np + 1);
			var c = C[(int)MathX.JsRound(t * n)];
			float ground = (float)gen.Height(c.P.X + ox, c.P.Z + oz);
			float top = c.P.Y - 0.75f;
			if (top - ground < 0.8f) continue;
			foreach (float sd in new[] { -0.55f, 0.55f })
			{
				var q = c.P + c.S * (sd * halfW);
				concrete.Cylinder(new Vector3(q.X, ground - 1.2f, q.Z), new Vector3(q.X, top, q.Z), 0.5f, 0.42f, 14);
			}
			concrete.Box(new Transform3D(Frame(c), new Vector3(c.P.X, top - 0.3f, c.P.Z)), new Vector3(halfW * 0.85f, 0.3f, 0.55f), 0.5f);
		}
		foreach (var c in new[] { C[0], C[n] })
		{
			float ground = (float)gen.Height(c.P.X + ox, c.P.Z + oz);
			float h = Math.Max(1.2f, c.P.Y - ground + 1.5f);
			concrete.Box(new Transform3D(Frame(c), new Vector3(c.P.X, c.P.Y - 0.4f - h / 2 + 0.2f, c.P.Z)), new Vector3(halfW + 0.3f, h / 2, 0.6f), 0.5f);
		}
		// a steel through-truss on wide northern rivers: box-section chords, verticals at every panel
		// point and diagonals running down toward the middle (a Pratt truss), gusset plates at the
		// joints, and struts with cross-bracing overhead where there is headroom
		if (truss)
		{
			const float H = 5.2f;
			float sideOff = halfW + 0.25f;
			float Rise(int i) => Math.Max(1.2f, H * Math.Min(1, Mathf.Sin(i / (float)n * Mathf.Pi) * 1.6f));
			// panel points every other station (about 6 m), and always at the far end
			var nodes = new List<int>();
			for (int i = 0; i < n; i += 2) nodes.Add(i);
			nodes.Add(n);
			var top = new Vector3[2][];
			for (int side = 0; side < 2; side++)
			{
				int sd = side * 2 - 1;
				var chordB = new List<Vector3>();
				var chordT = new List<Vector3>();
				for (int i = 0; i <= n; i++)
				{
					var b = C[i].P + C[i].S * (sd * sideOff) + up * 0.2f;
					chordB.Add(b);
					// the top chord rises in a shallow arch, dropping to the portals at the ends
					chordT.Add(b + up * Rise(i));
				}
				top[side] = chordT.ToArray();
				paint.LoftRect(chordB, cS, -0.18f, 0.18f, -0.3f, 0.2f);
				paint.LoftRect(chordT, cS, -0.2f, 0.2f, -0.2f, 0.2f);
				for (int k = 0; k < nodes.Count; k++)
				{
					int i = nodes[k];
					var s0 = C[i].S;
					paint.Beam(chordB[i] + up * 0.2f, chordT[i] - up * 0.2f, s0, 0.3f, 0.2f);
					// gusset plates either side of the joints
					foreach (var at in new[] { chordB[i], chordT[i] })
						foreach (float f in new[] { -0.215f, 0.215f })
							paint.Box(new Transform3D(Frame(C[i]), at + s0 * f), new Vector3(0.012f, 0.36f, 0.5f), 0.5f);
					if (k == nodes.Count - 1) continue;
					int j = nodes[k + 1];
					bool leftHalf = i + j <= n;
					if (leftHalf) paint.Beam(chordT[i] - up * 0.15f, chordB[j] + up * 0.15f, s0, 0.24f, 0.14f);
					else paint.Beam(chordB[i] + up * 0.15f, chordT[j] - up * 0.15f, s0, 0.24f, 0.14f);
				}
			}
			// overhead struts and cross-bracing where the top chords are high enough to drive under
			int last = -1;
			foreach (int i in nodes)
			{
				if (Rise(i) < 5.0f) continue;
				var a = top[0][i] - up * 0.05f;
				var b = top[1][i] - up * 0.05f;
				paint.Beam(a, b, C[i].T, 0.2f, 0.26f);
				if (last >= 0)
				{
					paint.Beam(top[0][last], top[1][i], up, 0.1f, 0.1f);
					paint.Beam(top[1][last], top[0][i], up, 0.1f, 0.1f);
				}
				last = i;
			}
		}

		var root = new Node3D();
		void Put(MeshBuilder mb, Material m, string name)
		{
			if (mb.VertexCount == 0) return;
			root.AddChild(new MeshInstance3D { Mesh = mb.ToMesh(), MaterialOverride = m, Name = name });
		}
		Put(concrete, Concrete, "Concrete");
		Put(steel, Steel, "Steel");
		Put(paint, r.Frozen ? PaintNorth : Paint, "Truss");

		// colliders: the deck and both parapets, a box per segment
		// (layer 2: structures, what the free camera walks on)
		var body = new StaticBody3D { Name = "Collider", CollisionLayer = 1u << 1, CollisionMask = 0 };
		for (int i = 0; i < n; i++)
		{
			var a = C[i].P;
			var b = C[i + 1].P;
			var mid = (a + b) / 2;
			var dir = b - a;
			float L = dir.Length();
			dir /= L;
			var side = new Vector3(dir.Z, 0, -dir.X).Normalized();
			var upn = dir.Cross(side).Normalized();
			var basis = new Basis(side, upn, dir);
			void Add(float hx, float hy, float hz, Vector3 off)
			{
				var shape = new CollisionShape3D
				{
					Shape = new BoxShape3D { Size = new Vector3(hx, hy, hz + 0.05f) * 2 },
					Transform = new Transform3D(basis, mid + basis * off),
				};
				body.AddChild(shape);
			}
			Add(halfW, 0.35f, L / 2, new Vector3(0, -0.35f + 0.012f, 0));
			Add(0.2f, 0.5f, L / 2, new Vector3(halfW - 0.18f, 0.3f, 0));
			Add(0.2f, 0.5f, L / 2, new Vector3(-(halfW - 0.18f), 0.3f, 0));
		}
		root.AddChild(body);
		return root;
	}
}
