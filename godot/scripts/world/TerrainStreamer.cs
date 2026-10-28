using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using Godot;

namespace DustRoad.World;

// Streams terrain tiles around the camera: a quadtree of tiles from 2 km down to 64 m, finer
// close by (as web/src/world/terrain.js). Tiles are worked out on worker threads and turned into
// meshes a few at a time per frame. In the editor it streams around the editor's camera, so the
// world is there to look at while editing the scene.
[Tool]
public partial class TerrainStreamer : Node3D
{
	const double Root = 2048;
	const double MinTile = 64;

	[Export] public Material TerrainMaterial;
	[Export] public float ViewRadius = 5600;
	// the editor streams a smaller ring (it is only for looking around)
	[Export] public float EditorViewRadius = 2500;
	[Export] public int Seed = 1234;
	// at most this much of each frame goes on turning finished tiles into meshes (ms)
	[Export] public float BuildBudgetMs = 3;
	// tiles being worked out at once (0: two per spare core)
	[Export] public int MaxInFlight = 0;

	sealed class Tile
	{
		public double X0, Z0, Size;
		public MeshInstance3D Node;
		// the heights of the finest tiles, kept for HeightAt (the rest of the mesh data is let go)
		public float[] Heights;
		public int HW;
		public double Step;
	}

	readonly Dictionary<(long, long, int), Tile> _tiles = new();
	readonly HashSet<(long, long, int)> _pending = new();
	readonly ConcurrentQueue<TileData> _done = new();
	readonly List<(double x0, double z0, double size, double d)> _wanted = new();
	readonly HashSet<(long, long, int)> _wantedKeys = new();
	ThreadLocal<WorldGen> _gens;
	CancellationTokenSource _cancel = new();
	int _genSeed = int.MinValue;
	double _lastQx = double.NaN, _lastQz = double.NaN;

	public bool AllBuilt
	{
		get
		{
			if (_wanted.Count == 0) return false;
			foreach (var key in _wantedKeys)
				if (!_tiles.ContainsKey(key)) return false;
			return true;
		}
	}
	public int TileCount => _tiles.Count;

	static (long, long, int) Key(double x0, double z0, double size) => ((long)x0, (long)z0, (int)size);

	public override void _Ready()
	{
		WorldOrigin.Shifted += OnOriginShifted;
	}

	public override void _ExitTree()
	{
		WorldOrigin.Shifted -= OnOriginShifted;
		_cancel.Cancel();
		Clear();
	}

	void Clear()
	{
		foreach (var t in _tiles.Values) t.Node?.QueueFree();
		_tiles.Clear();
		_pending.Clear();
		while (_done.TryDequeue(out _)) { }
		_lastQx = double.NaN;
	}

	void OnOriginShifted(double dx, double dz)
	{
		foreach (var t in _tiles.Values)
			if (t.Node != null) t.Node.Position = WorldOrigin.ToScene(t.X0, 0, t.Z0);
	}

	// The camera the terrain is streamed around: the editor's while editing, else the active one.
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
			// a new world: drop everything and start over with generators for this seed
			_cancel.Cancel();
			_cancel = new CancellationTokenSource();
			Clear();
			int seed = Seed;
			_gens = new ThreadLocal<WorldGen>(() => new WorldGen(seed));
			_genSeed = Seed;
		}
		var cam = FocusCamera();
		if (cam == null) return;
		var (px, pz) = WorldOrigin.ToWorld(cam.GlobalPosition);
		UpdateWanted(px, pz);
		Request(px, pz);
		BuildFinished();
		RetireReplaced();
	}

	// The tiles wanted around (px, pz): split while the camera is closer than 1.25 tile sizes.
	void UpdateWanted(double px, double pz)
	{
		double qx = Math.Round(px / (MinTile / 2)), qz = Math.Round(pz / (MinTile / 2));
		if (qx == _lastQx && qz == _lastQz) return;
		_lastQx = qx;
		_lastQz = qz;
		_wanted.Clear();
		_wantedKeys.Clear();
		double radius = Engine.IsEditorHint() ? Math.Min(ViewRadius, EditorViewRadius) : ViewRadius;
		int r0 = (int)Math.Ceiling(radius / Root);
		long cx = (long)Math.Floor(px / Root), cz = (long)Math.Floor(pz / Root);
		void Visit(double x0, double z0, double size)
		{
			double dx = Math.Max(Math.Abs(px - (x0 + size / 2)) - size / 2, 0);
			double dz = Math.Max(Math.Abs(pz - (z0 + size / 2)) - size / 2, 0);
			double d = Math.Sqrt(dx * dx + dz * dz);
			if (d > radius) return;
			if (size > MinTile && d < size * 1.25)
			{
				double h = size / 2;
				Visit(x0, z0, h);
				Visit(x0 + h, z0, h);
				Visit(x0, z0 + h, h);
				Visit(x0 + h, z0 + h, h);
			}
			else
			{
				_wanted.Add((x0, z0, size, d));
				_wantedKeys.Add(Key(x0, z0, size));
			}
		}
		for (long j = -r0; j <= r0; j++)
			for (long i = -r0; i <= r0; i++) Visit((cx + i) * Root, (cz + j) * Root, Root);
		_wanted.Sort((a, b) => a.d.CompareTo(b.d));
	}

	// Hands the nearest missing tiles to the workers (a few in flight at a time).
	void Request(double px, double pz)
	{
		int maxInFlight = MaxInFlight > 0 ? MaxInFlight : Math.Max(2, System.Environment.ProcessorCount - 1) * 2;
		var token = _cancel.Token;
		var gens = _gens;
		foreach (var (x0, z0, size, _) in _wanted)
		{
			if (_pending.Count >= maxInFlight) break;
			var key = Key(x0, z0, size);
			if (_tiles.ContainsKey(key) || _pending.Contains(key)) continue;
			_pending.Add(key);
			int n = size <= MinTile ? 64 : 32;
			Task.Run(() =>
			{
				if (token.IsCancellationRequested) return;
				var data = TerrainMesher.Build(gens.Value, x0, z0, size, n);
				if (!token.IsCancellationRequested) _done.Enqueue(data);
			}, token);
		}
	}

	void BuildFinished()
	{
		var sw = Stopwatch.StartNew();
		while (sw.Elapsed.TotalMilliseconds < BuildBudgetMs && _done.TryDequeue(out var data))
		{
			var key = Key(data.X0, data.Z0, data.Size);
			_pending.Remove(key);
			if (!_wantedKeys.Contains(key) || _tiles.ContainsKey(key)) continue;
			var mi = new MeshInstance3D
			{
				Mesh = TerrainMesher.ToMesh(data),
				MaterialOverride = TerrainMaterial,
				Position = WorldOrigin.ToScene(data.X0, 0, data.Z0),
				// near tiles cast shadows onto themselves (hillsides); far ones only receive
				CastShadow = data.Size <= 128 ? GeometryInstance3D.ShadowCastingSetting.On : GeometryInstance3D.ShadowCastingSetting.Off,
				Name = $"Tile {data.X0},{data.Z0} {data.Size}",
			};
			AddChild(mi);
			_tiles[key] = new Tile { X0 = data.X0, Z0 = data.Z0, Size = data.Size, Node = mi, Heights = data.Size <= MinTile ? data.Heights : null, HW = data.HW, Step = data.Step };
		}
	}

	// Drops tiles no longer wanted once every wanted tile over their ground is there (no holes
	// while the finer or coarser ones are still being made).
	void RetireReplaced()
	{
		List<(long, long, int)> drop = null;
		foreach (var (key, t) in _tiles)
		{
			if (_wantedKeys.Contains(key)) continue;
			bool covered = true;
			foreach (var (x0, z0, size, _) in _wanted)
			{
				if (x0 >= t.X0 + t.Size || x0 + size <= t.X0 || z0 >= t.Z0 + t.Size || z0 + size <= t.Z0) continue;
				if (!_tiles.ContainsKey(Key(x0, z0, size)))
				{
					covered = false;
					break;
				}
			}
			if (covered) (drop ??= new()).Add(key);
		}
		if (drop == null) return;
		foreach (var key in drop)
		{
			_tiles[key].Node?.QueueFree();
			_tiles.Remove(key);
		}
	}

	// Ground height under a world point from the tiles already made (NaN where there is none yet).
	public float HeightAt(double x, double z)
	{
		foreach (var t in _tiles.Values)
		{
			if (t.Heights == null || x < t.X0 || z < t.Z0 || x >= t.X0 + t.Size || z >= t.Z0 + t.Size) continue;
			double fx = (x - t.X0) / t.Step, fz = (z - t.Z0) / t.Step;
			int i = (int)fx, j = (int)fz;
			double u = fx - i, v = fz - j;
			float H(int a, int b) => t.Heights[(b + 1) * t.HW + (a + 1)];
			return (float)((H(i, j) * (1 - u) + H(i + 1, j) * u) * (1 - v) + (H(i, j + 1) * (1 - u) + H(i + 1, j + 1) * u) * v);
		}
		return float.NaN;
	}
}
