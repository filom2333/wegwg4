using System;
using System.Collections.Generic;
using Godot;

namespace DustRoad.World;

// Rivers and lakes around the camera: a ribbon along each river's meandering course and a disc
// for each lake, water or (in the frozen north) ice. A port of web/src/world/water.js.
[Tool]
public partial class WaterStreamer : Node3D
{
	const double Range = 1500; // how far around the camera water is built
	const double RiverHalfLen = 1100; // river ribbon extent either side of the road

	[Export] public Material WaterMaterial;
	[Export] public Material LakeMaterial;
	[Export] public Material IceMaterial;
	[Export] public int Seed = 1234;

	readonly Dictionary<string, (MeshInstance3D node, double ox, double oz)> _items = new();
	WorldGen _gen;
	int _genSeed = int.MinValue;
	double _acc = 1;

	public override void _Ready() => WorldOrigin.Shifted += OnOriginShifted;
	public override void _ExitTree() => WorldOrigin.Shifted -= OnOriginShifted;

	void OnOriginShifted(double dx, double dz)
	{
		foreach (var (node, ox, oz) in _items.Values) node.Position = WorldOrigin.ToScene(ox, 0, oz);
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
			foreach (var it in _items.Values) it.node.QueueFree();
			_items.Clear();
			_gen = new WorldGen(Seed);
			_genSeed = Seed;
		}
		// (a few times a second is plenty)
		_acc += delta;
		if (_acc < 0.5) return;
		_acc = 0;
		var cam = FocusCamera();
		if (cam == null) return;
		var (px, pz) = WorldOrigin.ToWorld(cam.GlobalPosition);
		var want = new HashSet<string>();
		foreach (var r in _gen.RiversNear(pz, 1).ToArray())
		{
			if (r.Dry || Math.Abs(r.Zr - pz) > Range + 300) continue;
			string key = "r" + r.K;
			want.Add(key);
			if (!_items.ContainsKey(key)) Add(key, BuildRiver(_gen, r), _gen.RoadX(r.Zr), r.Zr, r.Frozen ? IceMaterial : WaterMaterial);
		}
		foreach (var l in _gen.LakesNear(pz, 2).ToArray())
		{
			double dx = l.X - px, dz = l.Z - pz;
			if (Math.Sqrt(dx * dx + dz * dz) > Range) continue;
			string key = "l" + l.K;
			want.Add(key);
			if (!_items.ContainsKey(key)) Add(key, BuildLake(_gen, l), l.X, l.Z, l.Frozen ? IceMaterial : LakeMaterial ?? WaterMaterial);
		}
		List<string> drop = null;
		foreach (var k in _items.Keys)
			if (!want.Contains(k)) (drop ??= new()).Add(k);
		if (drop != null)
			foreach (var k in drop)
			{
				_items[k].node.QueueFree();
				_items.Remove(k);
			}
	}

	void Add(string key, ArrayMesh mesh, double ox, double oz, Material mat)
	{
		var mi = new MeshInstance3D
		{
			Mesh = mesh,
			MaterialOverride = mat,
			Position = WorldOrigin.ToScene(ox, 0, oz),
			CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
			Name = (mat == IceMaterial ? "Ice " : "Water ") + key,
		};
		AddChild(mi);
		_items[key] = (mi, ox, oz);
	}

	// Ribbon along the river's course, a little wider than the channel so the banks hide its edge.
	// UV: metres along the flow and across it; UV2.x: 0 mid-stream .. 1 at the edges.
	public static ArrayMesh BuildRiver(WorldGen gen, River r)
	{
		double xr = gen.RoadX(r.Zr);
		const double step = 5;
		int n = (int)Math.Ceiling(2 * RiverHalfLen / step);
		double[] across = { -1.15, -0.8, -0.4, 0, 0.4, 0.8, 1.15 };
		int na = across.Length;
		var pos = new Vector3[(n + 1) * na];
		var uv = new Vector2[pos.Length];
		var uv2 = new Vector2[pos.Length];
		var nrm = new Vector3[pos.Length];
		double along = 0, lx = double.NaN, lz = 0;
		for (int i = 0; i <= n; i++)
		{
			double x = xr - RiverHalfLen + i * step;
			double z = gen.RiverZ(r, x);
			const double e = 1.5;
			double tx = 2 * e, tz = gen.RiverZ(r, x + e) - gen.RiverZ(r, x - e);
			double tl = Math.Sqrt(tx * tx + tz * tz);
			double px = -tz / tl, pz = tx / tl; // across the flow
			var info = gen.RiverAt(x, z);
			double level = info?.Level ?? r.Level;
			if (!double.IsNaN(lx)) along += Math.Sqrt((x - lx) * (x - lx) + (z - lz) * (z - lz));
			lx = x;
			lz = z;
			for (int j = 0; j < na; j++)
			{
				double a = across[j] * r.W;
				int k = i * na + j;
				pos[k] = new Vector3((float)(x + px * a - xr), (float)level, (float)(z + pz * a - r.Zr));
				uv[k] = new Vector2((float)along, (float)a);
				uv2[k] = new Vector2((float)Math.Min(1, Math.Abs(across[j])), 0);
				// (the ribbon is nearly flat: tiny slopes would only tilt the reflections)
				nrm[k] = Vector3.Up;
			}
		}
		var idx = new List<int>(n * (na - 1) * 6);
		for (int i = 0; i < n; i++)
			for (int j = 0; j < na - 1; j++)
			{
				int a = i * na + j, b = a + 1, c = a + na + 1, d = a + na;
				// clockwise seen from above (x along, across +z-ish): the browser's order reversed
				idx.AddRange(new[] { a, d, b, b, d, c });
			}
		return Mesh(pos, nrm, uv, uv2, FaceUp(pos, idx));
	}

	// A disc out to the lake's wobbly shoreline (rings of points marched out to lakeDist = 1).
	// UV: metres from the lake's centre (for the ripples); UV2.x: 0 at the centre .. 1 at the shore.
	public static ArrayMesh BuildLake(WorldGen gen, Lake l)
	{
		const int rings = 10, segs = 64;
		var pos = new List<Vector3>();
		var uv = new List<Vector2>();
		var uv2 = new List<Vector2>();
		double c = Math.Cos(l.Rot), s = Math.Sin(l.Rot);
		for (int i = 0; i <= rings; i++)
		{
			double t = i / (double)rings;
			for (int j = 0; j < segs; j++)
			{
				double a = j / (double)segs * Math.PI * 2;
				double u = Math.Cos(a), v = Math.Sin(a);
				// local ellipse frame -> world
				double dx = u * l.Rx * c + v * l.Rz * s, dz = -u * l.Rx * s + v * l.Rz * c;
				double lo = 0.2, hi = 2;
				for (int k = 0; k < 14; k++)
				{
					double m = (lo + hi) / 2;
					if (WorldGen.LakeDist(l, l.X + dx * m, l.Z + dz * m) < 1) lo = m;
					else hi = m;
				}
				double rr = lo * 1.04 * t;
				pos.Add(new Vector3((float)(dx * rr), (float)l.Level, (float)(dz * rr)));
				uv.Add(new Vector2((float)(dx * rr), (float)(dz * rr)));
				uv2.Add(new Vector2((float)t, 0));
			}
		}
		var idx = new List<int>();
		for (int i = 0; i < rings; i++)
			for (int j = 0; j < segs; j++)
			{
				int a = i * segs + j, b = i * segs + (j + 1) % segs, cc = (i + 1) * segs + (j + 1) % segs, d = (i + 1) * segs + j;
				idx.AddRange(new[] { a, d, b, b, d, cc });
			}
		var nrm = new Vector3[pos.Count];
		Array.Fill(nrm, Vector3.Up);
		var p = pos.ToArray();
		return Mesh(p, nrm, uv.ToArray(), uv2.ToArray(), FaceUp(p, idx));
	}

	// Winds every triangle to face up (clockwise seen from above).
	static int[] FaceUp(Vector3[] pos, List<int> idx)
	{
		var o = idx.ToArray();
		for (int t = 0; t < o.Length; t += 3)
		{
			var n = (pos[o[t + 1]] - pos[o[t]]).Cross(pos[o[t + 2]] - pos[o[t]]);
			if (n.Y > 0) (o[t + 1], o[t + 2]) = (o[t + 2], o[t + 1]);
		}
		return o;
	}

	static ArrayMesh Mesh(Vector3[] pos, Vector3[] nrm, Vector2[] uv, Vector2[] uv2, int[] idx)
	{
		var arrays = new Godot.Collections.Array();
		arrays.Resize((int)Godot.Mesh.ArrayType.Max);
		arrays[(int)Godot.Mesh.ArrayType.Vertex] = pos;
		arrays[(int)Godot.Mesh.ArrayType.Normal] = nrm;
		arrays[(int)Godot.Mesh.ArrayType.TexUV] = uv;
		arrays[(int)Godot.Mesh.ArrayType.TexUV2] = uv2;
		arrays[(int)Godot.Mesh.ArrayType.Index] = idx;
		var m = new ArrayMesh();
		m.AddSurfaceFromArrays(Godot.Mesh.PrimitiveType.Triangles, arrays);
		return m;
	}
}
