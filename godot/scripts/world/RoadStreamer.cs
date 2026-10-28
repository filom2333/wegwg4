using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Godot;

namespace DustRoad.World;

// Streams the highway (128 m segments) and the dirt side tracks around the camera, made on worker
// threads like the terrain tiles.
[Tool]
public partial class RoadStreamer : Node3D
{
	[Export] public Material RoadMaterial;
	[Export] public float ViewRadius = 2400;
	[Export] public int Seed = 1234;
	// road strips turned into meshes per frame
	[Export] public int MaxPerFrame = 4;

	readonly Dictionary<long, (MeshInstance3D node, double ox, double oz)> _built = new();
	readonly HashSet<long> _pending = new();
	readonly HashSet<long> _wanted = new();
	readonly ConcurrentQueue<RoadData> _done = new();
	ThreadLocal<WorldGen> _gens;
	WorldGen _gen;
	CancellationTokenSource _cancel = new();
	int _genSeed = int.MinValue;

	public override void _Ready() => WorldOrigin.Shifted += OnOriginShifted;

	public override void _ExitTree()
	{
		WorldOrigin.Shifted -= OnOriginShifted;
		_cancel.Cancel();
	}

	void OnOriginShifted(double dx, double dz)
	{
		foreach (var (node, ox, oz) in _built.Values) node.Position = WorldOrigin.ToScene(ox, 0, oz);
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
			_cancel.Cancel();
			_cancel = new CancellationTokenSource();
			foreach (var b in _built.Values) b.node.QueueFree();
			_built.Clear();
			_pending.Clear();
			int seed = Seed;
			_gens = new ThreadLocal<WorldGen>(() => new WorldGen(seed));
			_gen = new WorldGen(seed);
			_genSeed = Seed;
		}
		var cam = FocusCamera();
		if (cam == null) return;
		var (px, pz) = WorldOrigin.ToWorld(cam.GlobalPosition);

		// highway segments within reach, nearest first (keys >= 0); side tracks near the player (< 0)
		_wanted.Clear();
		long k0 = (long)Math.Floor(pz / RoadMesher.Seg);
		long range = (long)Math.Ceiling(ViewRadius / RoadMesher.Seg);
		var order = new List<(long k, double d)>();
		for (long k = k0 - range; k <= k0 + range; k++)
		{
			double zc = k * RoadMesher.Seg + RoadMesher.Seg / 2;
			double dx = _gen.RoadX(zc) - px, dz = zc - pz;
			double d = Math.Sqrt(dx * dx + dz * dz);
			if (d > ViewRadius) continue;
			_wanted.Add(k);
			order.Add((k, d));
		}
		long t0 = (long)Math.Floor(pz / WorldGen.TrackEvery);
		for (long t = t0 - 2; t <= t0 + 2; t++)
		{
			var tr = _gen.TrackOf((int)t);
			if (tr == null || pz < tr.Z0 - 1800 || pz > tr.Z1 + 1800) continue;
			_wanted.Add(-1 - t);
			order.Add((-1 - t, Math.Abs(pz - (tr.Z0 + tr.Z1) / 2)));
		}
		order.Sort((a, b) => a.d.CompareTo(b.d));

		var token = _cancel.Token;
		var gens = _gens;
		foreach (var (k, _) in order)
		{
			if (_pending.Count >= 6) break;
			if (_built.ContainsKey(k) || _pending.Contains(k)) continue;
			_pending.Add(k);
			long kk = k;
			Task.Run(() =>
			{
				if (token.IsCancellationRequested) return;
				var g = gens.Value;
				var data = kk >= 0 ? RoadMesher.Segment(g, kk) : RoadMesher.Track(g, g.TrackOf((int)(-1 - kk)));
				data.Key = kk;
				if (!token.IsCancellationRequested) _done.Enqueue(data);
			}, token);
		}

		for (int n = 0; n < MaxPerFrame && _done.TryDequeue(out var data); n++)
		{
			_pending.Remove(data.Key);
			if (!_wanted.Contains(data.Key) || _built.ContainsKey(data.Key)) continue;
			var mi = new MeshInstance3D
			{
				Mesh = RoadMesher.ToMesh(data),
				MaterialOverride = RoadMaterial,
				Position = WorldOrigin.ToScene(data.OX, 0, data.OZ),
				CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
				Name = data.Key >= 0 ? $"Road {data.Key}" : $"Track {-1 - data.Key}",
			};
			AddChild(mi);
			_built[data.Key] = (mi, data.OX, data.OZ);
		}

		List<long> drop = null;
		foreach (var k in _built.Keys)
			if (!_wanted.Contains(k)) (drop ??= new()).Add(k);
		if (drop != null)
			foreach (var k in drop)
			{
				_built[k].node.QueueFree();
				_built.Remove(k);
			}
	}
}
