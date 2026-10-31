using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Godot;
using DustRoad.Core;

namespace DustRoad.World;

// Plants and loose rock around the camera, a port of web/src/world/scatter.js. Every 64 m cell's
// instances come from ScatterGen on worker threads. Whenever the camera moves into another cell
// (or new cells arrive) the instances are sorted, again on a worker, into one MultiMesh per
// species, variant, level of detail and sector round the camera (the sectors let the renderer
// skip what is behind), and swapped in at once. Close by every model is the full one; further
// out rocks and shrubs turn coarse, ground cover thins out and stops, trees hold on longest.
[Tool]
public partial class ScatterStreamer : Node3D
{
	[Export] public int Seed = 1234;
	// how far trees and rocks are drawn (the browser's "high" setting)
	[Export] public float Radius = 880;
	[Export] public float EditorRadius = 400;

	// (checking pictures: draw only this species)
	public static string Only;

	const int Cell = ScatterGen.Cell;
	const int Sectors = 8;
	// per instance: a 3x4 transform, then the colour (rock tint, snow)
	const int Stride = 16;

	sealed class CellData
	{
		public float[] Inst;
		// snow on the ground (taiga, tundra), and the tint loose rock takes there
		public float Snow;
		public Vector3 Tint;
	}

	sealed class Built
	{
		public Dictionary<(int si, int v, int lod, int sec), (float[] buf, int n)> Groups;
		public double Ox, Oz;
	}

	WorldGen _gen;
	int _genSeed = int.MinValue;
	int _epoch;
	FloraLibrary _lib;
	ThreadLocal<WorldGen> _tgen;
	readonly Dictionary<(int, int), CellData> _cells = new();
	readonly ConcurrentQueue<(int epoch, (int, int) key, CellData data)> _arrived = new();
	(int, int)? _lastCell;
	bool _dirty;
	double _sinceRebuild;
	Task<Built> _rebuild;
	Node3D _root;
	double _rootOx, _rootOz;
	readonly Dictionary<(int, int, int, int), MultiMeshInstance3D> _mmi = new();
	// colliders of the solid things (trunks, rocks, stumps, logs) in the cells near the camera
	readonly Dictionary<(int, int), StaticBody3D> _bodies = new();
	Node3D _colliders;

	// physics layer of loose scenery (bridges and buildings are on layer 2)
	public const uint SceneryLayer = 1u << 2;

	// how loose rock is tinted in each biome: the ground colour, its colour halved, darker
	static readonly Vector3[] RockTint = MakeRockTint();

	static Vector3[] MakeRockTint()
	{
		var t = new Vector3[9];
		for (int b = 0; b < 9; b++)
		{
			var g = WorldGen.BiomeGround[b];
			float lum = Math.Max((g[0] + g[1] + g[2]) / 3, 0.01f);
			float C(float c) => (1 + (c / lum - 1) * 0.55f) * 0.7f;
			t[b] = new Vector3(C(g[0]), C(g[1]), C(g[2]));
		}
		return t;
	}

	public override void _Ready() => WorldOrigin.Shifted += OnOriginShifted;
	public override void _ExitTree() => WorldOrigin.Shifted -= OnOriginShifted;

	void OnOriginShifted(double dx, double dz)
	{
		if (_root != null) _root.Position = WorldOrigin.ToScene(_rootOx, 0, _rootOz);
		foreach (var ((ci, cj), b) in _bodies) b.Position = WorldOrigin.ToScene(ci * Cell, 0, cj * Cell);
	}

	Camera3D FocusCamera()
	{
#if TOOLS
		if (Engine.IsEditorHint()) return EditorInterface.Singleton.GetEditorViewport3D(0)?.GetCamera3D();
#endif
		return GetViewport()?.GetCamera3D();
	}

	float Reach => Engine.IsEditorHint() ? EditorRadius : Radius;

	// True once every cell in reach has its instances and they are on screen.
	public bool AllBuilt
	{
		get
		{
			if (_lastCell == null || _dirty || _rebuild != null) return false;
			foreach (var c in _cells.Values)
				if (c == null) return false;
			return true;
		}
	}

	public override void _Process(double delta)
	{
		if (_genSeed != Seed)
		{
			_epoch++;
			_gen = new WorldGen(Seed);
			int seed = Seed;
			_tgen = new ThreadLocal<WorldGen>(() => new WorldGen(seed));
			_genSeed = Seed;
			_cells.Clear();
			_lastCell = null;
			foreach (var b in _bodies.Values) b.QueueFree();
			_bodies.Clear();
			foreach (var m in _mmi.Values) m.Multimesh.VisibleInstanceCount = 0;
		}
		_lib ??= new FloraLibrary();
		if (_root == null)
		{
			_root = new Node3D { Name = "Instances" };
			AddChild(_root);
		}
		var cam = FocusCamera();
		if (cam == null) return;
		var (px, pz) = WorldOrigin.ToWorld(cam.GlobalPosition);
		int ci = (int)Math.Floor(px / Cell), cj = (int)Math.Floor(pz / Cell);
		bool moved = _lastCell != (ci, cj);
		if (moved)
		{
			_lastCell = (ci, cj);
			Want(px, pz, ci, cj);
			_dirty = true;
		}
		while (_arrived.TryDequeue(out var a))
			if (a.epoch == _epoch && _cells.ContainsKey(a.key))
			{
				_cells[a.key] = a.data;
				_dirty = true;
			}
		_sinceRebuild += delta;
		if (_rebuild != null && _rebuild.IsCompleted)
		{
			Apply(_rebuild.Result);
			_rebuild = null;
		}
		if (!Engine.IsEditorHint()) UpdateColliders(px, pz);
		if (_dirty && _rebuild == null && (moved || _sinceRebuild > 0.25))
		{
			_dirty = false;
			_sinceRebuild = 0;
			var snap = new List<((int, int) key, CellData data)>(_cells.Count);
			foreach (var kv in _cells)
				if (kv.Value != null) snap.Add((kv.Key, kv.Value));
			double ox = WorldOrigin.X, oz = WorldOrigin.Z;
			float far = Reach;
			var lib = _lib;
			_rebuild = Task.Run(() => Sort(lib, snap, px, pz, ci, cj, ox, oz, far));
		}
	}

	// Colliders for the cells within 120 m (one new cell a frame), dropped past 170 m.
	void UpdateColliders(double px, double pz)
	{
		if (_colliders == null)
		{
			_colliders = new Node3D { Name = "Colliders" };
			AddChild(_colliders);
		}
		bool built = false;
		foreach (var (key, c) in _cells)
		{
			var (ci, cj) = key;
			double dx = (ci + 0.5) * Cell - px, dz = (cj + 0.5) * Cell - pz;
			double d = Math.Sqrt(dx * dx + dz * dz);
			if (d < 120 && c != null && !built && !_bodies.ContainsKey(key))
			{
				_bodies[key] = BuildBody(ci, cj, c);
				built = true;
			}
		}
		List<(int, int)> drop = null;
		foreach (var ((ci, cj), b) in _bodies)
		{
			double dx = (ci + 0.5) * Cell - px, dz = (cj + 0.5) * Cell - pz;
			if (Math.Sqrt(dx * dx + dz * dz) > 170 || !_cells.ContainsKey((ci, cj))) (drop ??= new()).Add((ci, cj));
		}
		if (drop != null)
			foreach (var k in drop)
			{
				_bodies[k].QueueFree();
				_bodies.Remove(k);
			}
	}

	StaticBody3D BuildBody(int ci, int cj, CellData c)
	{
		var body = new StaticBody3D { Name = $"Cell {ci},{cj}", CollisionLayer = SceneryLayer, CollisionMask = 0, Position = WorldOrigin.ToScene(ci * Cell, 0, cj * Cell) };
		var data = c.Inst;
		for (int k = 0; k < data.Length; k += ScatterGen.Stride)
		{
			var def = ScatterGen.Table[(int)data[k]];
			if (def.Solid == ScatterGen.Solid.None) continue;
			float s = data[k + 5], rot = data[k + 6];
			var p = new Vector3(data[k + 2], data[k + 3] - (float)ScatterGen.SinkOf(def, s), data[k + 4]);
			Shape3D shape;
			var xf = Transform3D.Identity;
			switch (def.Solid)
			{
				case ScatterGen.Solid.Ball:
					shape = new SphereShape3D { Radius = 0.75f * s };
					xf.Origin = p + new Vector3(0, 0.2f * s, 0);
					break;
				case ScatterGen.Solid.TrunkWide:
					shape = new CylinderShape3D { Height = 3.2f * s, Radius = 1.0f * s };
					xf.Origin = p + new Vector3(0, 1.6f * s, 0);
					break;
				case ScatterGen.Solid.Stump:
					shape = new CylinderShape3D { Height = 0.6f * s, Radius = 0.3f * s };
					xf.Origin = p + new Vector3(0, 0.3f * s, 0);
					break;
				case ScatterGen.Solid.Log:
					// lying along its length (the model's x), turned by its yaw
					shape = new CapsuleShape3D { Radius = 0.22f * s, Height = 2.8f * s + 0.44f * s };
					xf = new Transform3D(new Basis(Vector3.Up, rot) * new Basis(Vector3.Back, Mathf.Pi / 2), p + new Vector3(0, 0.22f * s, 0));
					break;
				default:
					shape = new CylinderShape3D { Height = 3f * s, Radius = 0.22f * s };
					xf.Origin = p + new Vector3(0, 1.5f * s, 0);
					break;
			}
			body.AddChild(new CollisionShape3D { Shape = shape, Transform = xf });
		}
		_colliders.AddChild(body);
		return body;
	}

	// Cells in reach of the camera: new ones asked of the workers (nearest first), far ones dropped.
	void Want(double px, double pz, int ci, int cj)
	{
		float far = Reach;
		int R = (int)Math.Ceiling(far / Cell);
		var want = new HashSet<(int, int)>();
		var ask = new List<(int ring, int i, int j)>();
		for (int j = -R; j <= R; j++)
			for (int i = -R; i <= R; i++)
			{
				double cx = (ci + i) * Cell + Cell / 2.0, cz = (cj + j) * Cell + Cell / 2.0;
				if (Math.Sqrt((cx - px) * (cx - px) + (cz - pz) * (cz - pz)) > far + Cell) continue;
				var k = (ci + i, cj + j);
				want.Add(k);
				if (_cells.ContainsKey(k)) continue;
				_cells[k] = null;
				ask.Add((Math.Max(Math.Abs(i), Math.Abs(j)), ci + i, cj + j));
			}
		List<(int, int)> drop = null;
		foreach (var k in _cells.Keys)
			if (!want.Contains(k)) (drop ??= new()).Add(k);
		if (drop != null)
			foreach (var k in drop) _cells.Remove(k);
		ask.Sort((a, b) => a.ring.CompareTo(b.ring));
		int epoch = _epoch;
		var tgen = _tgen;
		// a handful of cells per task: enough work to be worth a task, small enough to arrive soon
		for (int s = 0; s < ask.Count; s += 6)
		{
			var batch = ask.GetRange(s, Math.Min(6, ask.Count - s));
			Task.Run(() =>
			{
				var gen = tgen.Value;
				var bw = new double[9];
				foreach (var (_, i, j) in batch)
				{
					var inst = ScatterGen.CellInstances(gen, i, j);
					gen.BiomeWeights(i * Cell + Cell / 2.0, j * Cell + Cell / 2.0, bw);
					int top = 0;
					for (int b = 1; b < 9; b++)
						if (bw[b] > bw[top]) top = b;
					float snow = (float)(bw[(int)Biome.Taiga] + bw[(int)Biome.Tundra]);
					_arrived.Enqueue((epoch, (i, j), new CellData { Inst = inst, Snow = snow, Tint = RockTint[top] }));
				}
			});
		}
	}

	// Sorts every instance in reach into its group's buffer (worker thread).
	static Built Sort(FloraLibrary lib, List<((int, int) key, CellData data)> cells, double px, double pz, int pci, int pcj, double ox, double oz, float far)
	{
		var lists = new Dictionary<(int, int, int, int), List<float>>();
		var table = ScatterGen.Table;
		foreach (var ((ci, cj), c) in cells)
		{
			int ring = Math.Max(Math.Abs(ci - pci), Math.Abs(cj - pcj));
			double ccx = (ci + 0.5) * Cell, ccz = (cj + 0.5) * Cell;
			double d = Math.Sqrt((ccx - px) * (ccx - px) + (ccz - pz) * (ccz - pz));
			// the sector round the camera (the ring next to it is one group of its own)
			int sec = ring <= 1 ? 0 : 1 + (int)((Math.Atan2(ccz - pz, ccx - px) + Math.PI) / (2 * Math.PI) * Sectors) % Sectors;
			float x0 = (float)(ci * Cell - ox), z0 = (float)(cj * Cell - oz);
			var data = c.Inst;
			for (int k = 0; k < data.Length; k += ScatterGen.Stride)
			{
				int si = (int)data[k];
				var def = table[si];
				var variants = lib.Species[si];
				if (variants == null || (Only != null && def.Id != Only)) continue;
				float aux = data[k + 7];
				int lod;
				if (def.Near > 0)
				{
					if (ring > def.Near) continue;
					if (ring == def.Near && !def.Rock && aux > 0.5f) continue;
					lod = ring <= 1 ? 0 : def.Lod1 != ScatterGen.Lod1.None ? 1 : 0;
				}
				else
				{
					if (d > far * def.Far + Cell * 0.5) continue;
					lod = ring <= 1 || def.Lod1 == ScatterGen.Lod1.None ? 0 : def.Mid > 0 && ring <= def.Mid ? 2 : 1;
				}
				var vv = variants[(int)data[k + 1]];
				// a level the models don't have falls back to the next finer one
				if (lod == 1 && vv.Lod1 == null) lod = vv.Mid != null ? 2 : 0;
				if (lod == 2 && vv.Mid == null) lod = 0;
				var key = (si, (int)data[k + 1], lod, sec);
				if (!lists.TryGetValue(key, out var list)) lists[key] = list = new List<float>(64 * Stride);
				float s = data[k + 5], rot = data[k + 6];
				float tx = x0 + data[k + 2], ty = data[k + 3] - (float)ScatterGen.SinkOf(def, s), tz = z0 + data[k + 4];
				Basis b;
				Vector4 col;
				if (def.Rock)
				{
					// rocks lie every which way: a turn and a slight tilt (hoodoos stand nearly upright)
					float tilt = def.Id == "hoodoo" ? 0.2f : 1f;
					float ax = (float)((rot % 0.3) - 0.15) * tilt, az = (float)(((rot * 7) % 0.3) - 0.15) * tilt;
					b = new Basis(Vector3.Up, rot) * Basis.FromEuler(new Vector3(ax, 0, az), EulerOrder.Xyz);
					int bi = (int)Math.Floor(aux);
					float shade = 0.9f + (aux - bi) * 0.4f;
					var t = RockTint[Math.Clamp(bi, 0, 8)] * shade;
					col = new Vector4(t.X, t.Y, t.Z, c.Snow);
				}
				else
				{
					b = new Basis(Vector3.Up, rot);
					col = new Vector4(1, 1, 1, c.Snow);
				}
				b = b.Scaled(new Vector3(s, s, s));
				// (MultiMesh rows: basis row, origin component)
				list.Add(b.X.X); list.Add(b.Y.X); list.Add(b.Z.X); list.Add(tx);
				list.Add(b.X.Y); list.Add(b.Y.Y); list.Add(b.Z.Y); list.Add(ty);
				list.Add(b.X.Z); list.Add(b.Y.Z); list.Add(b.Z.Z); list.Add(tz);
				list.Add(col.X); list.Add(col.Y); list.Add(col.Z); list.Add(col.W);
			}
		}
		var built = new Built { Groups = new(), Ox = ox, Oz = oz };
		foreach (var (key, list) in lists) built.Groups[key] = (list.ToArray(), list.Count / Stride);
		return built;
	}

	// Swaps the sorted instances in: every group's MultiMesh gets its new buffer (growing when it
	// must), groups with none this time are emptied.
	void Apply(Built built)
	{
		foreach (var (key, mmi) in _mmi)
			if (!built.Groups.ContainsKey(key)) mmi.Multimesh.VisibleInstanceCount = 0;
		foreach (var (key, (buf, n)) in built.Groups)
		{
			var (si, v, lod, sec) = key;
			if (!_mmi.TryGetValue(key, out var mmi))
			{
				var vv = _lib.Species[si][v];
				var def = ScatterGen.Table[si];
				var mesh = lod == 1 ? vv.Lod1 : lod == 2 ? vv.Mid : vv.Lod0;
				mmi = new MultiMeshInstance3D
				{
					Name = $"{def.Id}_{v}_{"fcm"[lod]}{sec}",
					Multimesh = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, UseColors = true, Mesh = mesh },
					CastShadow = def.Shadow ? GeometryInstance3D.ShadowCastingSetting.On : GeometryInstance3D.ShadowCastingSetting.Off,
				};
				_root.AddChild(mmi);
				_mmi[key] = mmi;
			}
			var mm = mmi.Multimesh;
			if (mm.InstanceCount < n)
			{
				int cap = Math.Max(16, mm.InstanceCount);
				while (cap < n) cap *= 2;
				mm.InstanceCount = cap;
			}
			int full = mm.InstanceCount * Stride;
			var data = buf;
			if (data.Length < full) Array.Resize(ref data, full);
			mm.Buffer = data;
			mm.VisibleInstanceCount = n;
		}
		_rootOx = built.Ox;
		_rootOz = built.Oz;
		_root.Position = WorldOrigin.ToScene(_rootOx, 0, _rootOz);
	}
}
