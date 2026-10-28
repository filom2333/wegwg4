using System;
using System.Collections.Generic;
using Godot;

namespace DustRoad.World;

// A strip of road (highway segment or dirt side track), made on a worker thread. Positions are
// relative to (OX, OZ).
public sealed class RoadData
{
	public long Key;
	public double OX, OZ;
	public Vector3[] Pos;
	public Vector3[] Nrm;
	public Vector2[] Uv;
	// road: wear, dirt (0/1), full width (m), markings (0/1); env: snow, bridge deck
	public float[] Road;
	public float[] Env;
	public int[] Index;
}

// Road strips: a port of the highway segments and side tracks in web/src/world/terrain.js.
public static class RoadMesher
{
	public const double Seg = 128;
	const double SPeriod = 12288;

	public static RoadData Segment(WorldGen gen, long k)
	{
		double z0 = k * Seg;
		const double step = 2;
		int nz = (int)(Seg / step);
		const double hw = WorldGen.RoadHalfWidth;
		const double W = (WorldGen.RoadHalfWidth + WorldGen.RoadShoulder) * 2;
		double[] across = { -W / 2 - 0.5, -W / 2, -hw - 0.6, -hw, -2.4, -1.2, 0, 1.2, 2.4, hw, hw + 0.6, W / 2, W / 2 + 0.5 };
		int na = across.Length;
		int n = (nz + 1) * na;
		var d = new RoadData { Key = k, OX = gen.RoadX(z0), OZ = z0, Pos = new Vector3[n], Uv = new Vector2[n], Road = new float[n * 4], Env = new float[n * 2] };
		// distance along the road, counted from the last multiple of 12288 m before the segment: a
		// multiple of every pattern's period (lane dashes 12 m, textures 1.6 to 4 m), so the
		// markings run on unbroken, and small enough to keep the shader's precision
		double sBase = Math.Floor(gen.RoadS(z0) / SPeriod) * SPeriod;
		for (int j = 0; j <= nz; j++)
		{
			double z = z0 + j * step;
			double rx = gen.RoadX(z);
			double s = gen.RoadS(z);
			var (dx, dz) = gen.RoadDir(z);
			double px = dz, pz = -dx; // perpendicular
			var info = gen.RoadInfo(z);
			var br = gen.BridgeNear(z);
			bool onBridge = br != null && Math.Abs(z - br.Value.r.Zr) < br.Value.r.W + 12 + br.Value.r.W * 0.6 + 4;
			for (int i = 0; i < na; i++)
			{
				double a = across[i];
				double x = rx + px * a, zz = z + pz * a;
				// over a river the road keeps its own profile: the bridge deck
				double y = gen.RoadSurfaceY(x, zz) + 0.012;
				if (Math.Abs(a) > W / 2 + 0.01) y -= 0.3;
				int q = j * na + i;
				d.Pos[q] = new Vector3((float)(x - d.OX), (float)y, (float)(zz - d.OZ));
				d.Uv[q] = new Vector2((float)((Math.Clamp(a, -W / 2, W / 2) + W / 2) / W), (float)(s - sBase));
				d.Road[q * 4] = (float)info.wear;
				d.Road[q * 4 + 1] = info.dirt ? 1 : 0;
				d.Road[q * 4 + 2] = (float)W;
				d.Road[q * 4 + 3] = 1;
				d.Env[q * 2] = (float)info.snow;
				d.Env[q * 2 + 1] = onBridge ? 1 : 0;
			}
		}
		var idx = new List<int>(nz * (na - 1) * 6);
		for (int j = 0; j < nz; j++) Strip(idx, j, na);
		d.Index = idx.ToArray();
		d.Nrm = Normals(d.Pos, d.Index);
		return d;
	}

	// A dirt track as a strip following its centre line, from where it leaves the asphalt to where
	// it meets it again.
	public static RoadData Track(WorldGen gen, Track tr)
	{
		const double hw = WorldGen.TrackHalfWidth;
		const double W = (hw + 0.4) * 2;
		double[] across = { -W / 2 - 0.5, -W / 2, -hw * 0.75, -hw * 0.35, 0, hw * 0.35, hw * 0.75, W / 2, W / 2 + 0.5 };
		int na = across.Length;
		const double step = 2;
		// from where its edge first leaves the asphalt: the strip is pinched against the asphalt edge
		// there, so the track opens out of the shoulder like a real turn-off
		const double start = WorldGen.RoadHalfWidth * 0.5;
		var rows = new List<double>();
		for (double z = tr.Z0; z <= tr.Z1; z += step)
			if (Math.Abs(WorldGen.TrackOffset(tr, z)) >= start) rows.Add(z);
		int n = rows.Count * na;
		var d = new RoadData { Key = -1 - tr.T, OX = gen.RoadX(tr.Z0), OZ = tr.Z0, Pos = new Vector3[n], Uv = new Vector2[n], Road = new float[n * 4], Env = new float[n * 2] };
		double along = 0, lx = double.NaN, lz = 0;
		for (int j = 0; j < rows.Count; j++)
		{
			double z = rows[j];
			double cx = gen.TrackX(tr, z);
			double sl = (gen.TrackX(tr, z + 1) - gen.TrackX(tr, z - 1)) / 2;
			double l = Math.Sqrt(sl * sl + 1);
			double nx = 1 / l, nzz = -sl / l; // perpendicular
			if (!double.IsNaN(lx)) along += Math.Sqrt((cx - lx) * (cx - lx) + (z - lz) * (z - lz));
			lx = cx;
			lz = z;
			double snow = gen.RoadInfo(z).snow;
			for (int i = 0; i < na; i++)
			{
				double a = across[i];
				double x = cx + nx * a;
				double zz = z + nzz * a;
				double rx = gen.RoadX(zz);
				if ((x - rx) * tr.Side < WorldGen.RoadHalfWidth) x = rx + tr.Side * WorldGen.RoadHalfWidth;
				double y = gen.Height(x, zz) + 0.03;
				if (Math.Abs(a) > W / 2 + 0.01) y -= 0.3;
				int q = j * na + i;
				d.Pos[q] = new Vector3((float)(x - d.OX), (float)y, (float)(zz - d.OZ));
				d.Uv[q] = new Vector2((float)((Math.Clamp(a, -W / 2, W / 2) + W / 2) / W), (float)along);
				d.Road[q * 4] = 0.8f;
				d.Road[q * 4 + 1] = 1;
				d.Road[q * 4 + 2] = (float)W;
				d.Road[q * 4 + 3] = 0;
				d.Env[q * 2] = (float)snow;
			}
		}
		var idx = new List<int>();
		for (int j = 0; j < rows.Count - 1; j++)
		{
			// a gap where the track crosses back over the highway corridor (never, but be safe)
			if (rows[j + 1] - rows[j] > step * 1.5) continue;
			Strip(idx, j, na);
		}
		d.Index = idx.ToArray();
		d.Nrm = Normals(d.Pos, d.Index);
		return d;
	}

	// One row of quads between row j and j + 1 (clockwise from above: Godot's front face).
	static void Strip(List<int> idx, int j, int na)
	{
		for (int i = 0; i < na - 1; i++)
		{
			int a = j * na + i, b = a + 1, c = a + na + 1, e = a + na;
			idx.Add(a); idx.Add(b); idx.Add(e);
			idx.Add(b); idx.Add(c); idx.Add(e);
		}
	}

	// Smooth vertex normals: the area-weighted normals of the triangles round each vertex.
	static Vector3[] Normals(Vector3[] pos, int[] index)
	{
		var n = new Vector3[pos.Length];
		for (int t = 0; t < index.Length; t += 3)
		{
			int a = index[t], b = index[t + 1], c = index[t + 2];
			// (clockwise winding: the face normal is (c - a) x (b - a))
			var fn = (pos[c] - pos[a]).Cross(pos[b] - pos[a]);
			n[a] += fn;
			n[b] += fn;
			n[c] += fn;
		}
		for (int i = 0; i < n.Length; i++) n[i] = n[i].LengthSquared() > 0 ? n[i].Normalized() : Vector3.Up;
		return n;
	}

	public static ArrayMesh ToMesh(RoadData d)
	{
		var arrays = new Godot.Collections.Array();
		arrays.Resize((int)Mesh.ArrayType.Max);
		arrays[(int)Mesh.ArrayType.Vertex] = d.Pos;
		arrays[(int)Mesh.ArrayType.Normal] = d.Nrm;
		arrays[(int)Mesh.ArrayType.TexUV] = d.Uv;
		arrays[(int)Mesh.ArrayType.Custom0] = d.Road;
		arrays[(int)Mesh.ArrayType.Custom1] = d.Env;
		arrays[(int)Mesh.ArrayType.Index] = d.Index;
		var flags = (Mesh.ArrayFormat)(((long)Mesh.ArrayCustomFormat.RgbaFloat << (int)Mesh.ArrayFormat.FormatCustom0Shift) | ((long)Mesh.ArrayCustomFormat.RgFloat << (int)Mesh.ArrayFormat.FormatCustom1Shift));
		var mesh = new ArrayMesh();
		if (d.Index.Length > 0) mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays, null, null, flags);
		return mesh;
	}
}
