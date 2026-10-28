using System;
using System.Collections.Generic;
using Godot;
using DustRoad.Core;

namespace DustRoad.World;

// One terrain tile's mesh data, made on a worker thread (only plain arrays: the main thread turns
// them into a mesh). Positions are relative to the tile's corner (x0, z0).
public sealed class TileData
{
	public double X0, Z0, Size;
	public Vector3[] Pos;
	public Vector3[] Nrm;
	public Color[] Tint;
	public Vector2[] Uv;
	public Vector2[] Uv2;
	// material weights (sand, dirt, rock, salt / grass, snow, forest floor, gravel), 4 floats a vertex
	// (float, not packed bytes: the Compatibility renderer reads only float custom data)
	public float[] MatA;
	public float[] MatB;
	public int[] Index;
	public float MinY, MaxY;
	// heights on the tile's grid with a one-cell border (for colliders)
	public float[] Heights;
	public int HW;
	public double Step;
}

// Terrain tile mesher: a port of web/src/world/terrainMesh.js (and treeCover.js). Pure: runs on
// worker threads with that thread's own WorldGen.
public static class TerrainMesher
{
	// crown area one tree shades (m²), species densities per 1000 m² by biome (scatterGen.js),
	// the clustering noise threshold and the steepest ground (normal y) they grow on
	static readonly (double crown, double[] dens, double cluster, double slope)[] Trees =
	{
		(34, Dens(forest: 20, prairie: 0.45, highland: 0.25), -0.15, 0.78), // pine
		(30, Dens(taiga: 13, tundra: 1.3), -0.2, 0.78), // snow pine
		(24, Dens(forest: 3.4, prairie: 0.6), 0.1, 0.86), // birch
		(16, Dens(taiga: 4, tundra: 1.5), 0.2, 0.86), // bare birch
	};

	static double[] Dens(double scrub = 0, double dunes = 0, double badlands = 0, double saltflat = 0, double highland = 0, double prairie = 0, double forest = 0, double taiga = 0, double tundra = 0) =>
		new[] { scrub, dunes, badlands, saltflat, highland, prairie, forest, taiga, tundra };

	// Fraction of the ground under tree crowns (0..1), for the canopy painted on far ground.
	public static double TreeCover(WorldGen gen, double x, double z, double[] bw, double ny, List<Poi> pois)
	{
		double n = gen.NC.Noise2(x * 0.011, z * 0.011);
		double cov = 0;
		foreach (var t in Trees)
		{
			if (ny < t.slope - 0.04) continue;
			double d = 0;
			for (int b = 0; b < WorldGen.BiomeCount; b++) d += t.dens[b] * bw[b];
			if (d <= 0) continue;
			double keep = Math.Min(1, Math.Max(0, (n - t.cluster) / 0.2));
			cov += d / 1000 * keep * t.crown;
		}
		if (cov <= 0) return 0;
		// how much of that the road and the places' yards leave
		double k = Math.Min(1, Math.Max(0, (gen.RoadDist(x, z) - WorldGen.RoadHalfWidth - 8) / 16));
		foreach (var p in pois)
		{
			double dx = x - p.X, dz = z - p.Z;
			double dp = Math.Sqrt(dx * dx + dz * dz);
			if (dp < p.PadR + 30) k *= Math.Max(0, (dp - p.PadR) / 30);
		}
		return Math.Min(1, cov * k);
	}

	public static TileData Build(WorldGen gen, double x0, double z0, double size, int N, bool withSkirt = true)
	{
		double step = size / N;
		int W = N + 1;
		// heights with a 1-vertex border for normals
		int HW = N + 3;
		var H = new double[HW * HW];
		for (int j = 0; j < HW; j++)
			for (int i = 0; i < HW; i++)
				H[j * HW + i] = gen.Height(x0 + (i - 1) * step, z0 + (j - 1) * step);
		// The road lies on top at every distance: near it no vertex stands above the lowest road
		// surface within a cell along it. (On a far, coarse tile the triangles across the road join
		// points a cell apart: in a dip, or between the banks of a cutting, they would pass over the
		// asphalt and the ground would show through it.) Coarse tiles also lower the points a cell
		// beyond the shoulder, whose triangles reach over its edge.
		const double corridor = WorldGen.RoadHalfWidth + WorldGen.RoadShoulder;
		double reach = corridor + (step > 2 ? step : 0);
		double ds = Math.Max(1, step / 4);
		for (int j = 0; j < HW; j++)
		{
			double z = z0 + (j - 1) * step;
			double rx = gen.RoadX(z);
			for (int i = 0; i < HW; i++)
			{
				double x = x0 + (i - 1) * step;
				if (Math.Abs(x - rx) > reach) continue;
				double lo = double.PositiveInfinity;
				for (double s = -step; s <= step + 1e-6; s += ds) lo = Math.Min(lo, gen.RoadSurfaceY(gen.RoadX(z + s), z + s));
				double cap = lo - 0.03;
				if (H[j * HW + i] > cap) H[j * HW + i] = cap;
			}
		}
		int vCount = W * W + (withSkirt ? 4 * W : 0);
		var d = new TileData
		{
			X0 = x0, Z0 = z0, Size = size, Step = step, HW = HW,
			Pos = new Vector3[vCount], Nrm = new Vector3[vCount], Tint = new Color[vCount],
			Uv = new Vector2[vCount], Uv2 = new Vector2[vCount], MatA = new float[vCount * 4], MatB = new float[vCount * 4],
			Heights = new float[HW * HW],
		};
		for (int k = 0; k < H.Length; k++) d.Heights[k] = (float)H[k];
		var pois = gen.PoisNear(z0 + size / 2, (int)Math.Ceiling(size / 1200) + 1);
		var bw = new double[WorldGen.BiomeCount];
		Span<double> m = stackalloc double[8];
		// world texture coordinates, relative to the 2048 m period the tile starts in (so they run on
		// past its far edge instead of wrapping inside it)
		double ubx = Math.Floor(x0 / 2048) * 2048, ubz = Math.Floor(z0 / 2048) * 2048;
		float minY = float.PositiveInfinity, maxY = float.NegativeInfinity;
		for (int j = 0; j < W; j++)
			for (int i = 0; i < W; i++)
			{
				int k = j * W + i;
				double x = x0 + i * step, z = z0 + j * step;
				double h = H[(j + 1) * HW + (i + 1)];
				d.Pos[k] = new Vector3((float)(i * step), (float)h, (float)(j * step));
				minY = Math.Min(minY, (float)h);
				maxY = Math.Max(maxY, (float)h);
				double hx = H[(j + 1) * HW + (i + 2)] - H[(j + 1) * HW + i];
				double hz = H[(j + 2) * HW + (i + 1)] - H[j * HW + (i + 1)];
				var nrm = new Vector3((float)-hx, (float)(2 * step), (float)-hz).Normalized();
				d.Nrm[k] = nrm;
				gen.BiomeWeights(x, z, bw);
				gen.GroundMaterial(x, z, nrm.Y, bw, m);
				for (int c = 0; c < 4; c++)
				{
					d.MatA[k * 4 + c] = (float)m[c];
					d.MatB[k * 4 + c] = (float)m[4 + c];
				}
				double r = 0, g = 0, b = 0, veg = 0;
				for (int bb = 0; bb < WorldGen.BiomeCount; bb++)
				{
					double w = bw[bb];
					if (w == 0) continue;
					var c = WorldGen.BiomeGround[bb];
					r += c[0] * w;
					g += c[1] * w;
					b += c[2] * w;
					veg += WorldGen.BiomeShrubs[bb] * w;
				}
				// broad colour drift across the land: redder, yellower and greyer stretches
				var cv = gen.TintDrift(x, z);
				veg *= 0.55 + 0.9 * Math.Max(0, gen.NC.Noise2(x * 0.004 + 3, z * 0.004 - 8) * 0.5 + 0.5 - 0.2);
				d.Tint[k] = new Color((float)(r * cv.r), (float)(g * cv.g), (float)(b * cv.b), (float)veg);
				d.Uv2[k] = new Vector2((float)TreeCover(gen, x, z, bw, nrm.Y, pois), 0);
				d.Uv[k] = new Vector2((float)(x - ubx), (float)(z - ubz));
			}
		d.MinY = minY;
		d.MaxY = maxY;
		var idx = new List<int>(N * N * 6 + (withSkirt ? 4 * N * 6 : 0));
		// (Godot's front faces wind clockwise seen from the front: the browser's order reversed)
		for (int j = 0; j < N; j++)
			for (int i = 0; i < N; i++)
			{
				int a = j * W + i, b = a + 1, c = a + W + 1, e = a + W;
				// alternate diagonal for better shape following
				if ((i + j) % 2 == 0) idx.AddRange(new[] { a, b, e, b, c, e });
				else idx.AddRange(new[] { a, c, e, a, b, c });
			}
		if (withSkirt)
		{
			// skirts drop below each edge to hide the cracks between levels of detail
			double drop = Math.Max(1.5, step * 1.2);
			int baseV = W * W;
			for (int e = 0; e < 4; e++)
			{
				for (int t = 0; t < W; t++)
				{
					int src = e switch { 0 => t, 1 => N * W + t, 2 => t * W, _ => t * W + N };
					int k = baseV + t;
					d.Pos[k] = d.Pos[src] - new Vector3(0, (float)drop, 0);
					d.Nrm[k] = d.Nrm[src];
					d.Tint[k] = d.Tint[src];
					d.Uv[k] = d.Uv[src];
					d.Uv2[k] = d.Uv2[src];
					Array.Copy(d.MatA, src * 4, d.MatA, k * 4, 4);
					Array.Copy(d.MatB, src * 4, d.MatB, k * 4, 4);
				}
				for (int t = 0; t < W - 1; t++)
				{
					int src0 = e switch { 0 => t, 1 => N * W + t, 2 => t * W, _ => t * W + N };
					int src1 = e switch { 0 => t + 1, 1 => N * W + t + 1, 2 => (t + 1) * W, _ => (t + 1) * W + N };
					int a = src0, b = src1, c = baseV + t + 1, dd = baseV + t;
					// facing out of the tile
					if (e == 0 || e == 3) idx.AddRange(new[] { a, dd, b, b, dd, c });
					else idx.AddRange(new[] { a, b, dd, b, c, dd });
				}
				baseV += W;
			}
		}
		d.Index = idx.ToArray();
		return d;
	}

	// The tile as a mesh (main thread).
	public static ArrayMesh ToMesh(TileData d)
	{
		var arrays = new Godot.Collections.Array();
		arrays.Resize((int)Mesh.ArrayType.Max);
		arrays[(int)Mesh.ArrayType.Vertex] = d.Pos;
		arrays[(int)Mesh.ArrayType.Normal] = d.Nrm;
		arrays[(int)Mesh.ArrayType.Color] = d.Tint;
		arrays[(int)Mesh.ArrayType.TexUV] = d.Uv;
		arrays[(int)Mesh.ArrayType.TexUV2] = d.Uv2;
		arrays[(int)Mesh.ArrayType.Custom0] = d.MatA;
		arrays[(int)Mesh.ArrayType.Custom1] = d.MatB;
		arrays[(int)Mesh.ArrayType.Index] = d.Index;
		var flags = (Mesh.ArrayFormat)(((long)Mesh.ArrayCustomFormat.RgbaFloat << (int)Mesh.ArrayFormat.FormatCustom0Shift) | ((long)Mesh.ArrayCustomFormat.RgbaFloat << (int)Mesh.ArrayFormat.FormatCustom1Shift));
		var mesh = new ArrayMesh();
		mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays, null, null, flags);
		mesh.CustomAabb = new Aabb(new Vector3(0, d.MinY - 3, 0), new Vector3((float)d.Size, d.MaxY - d.MinY + 3, (float)d.Size));
		return mesh;
	}
}
