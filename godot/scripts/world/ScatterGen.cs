using System;
using System.Collections.Generic;
using DustRoad.Core;

namespace DustRoad.World;

// What grows (and lies about) where: the species table and the deterministic instance list of one
// 64 m cell. A port of web/src/world/scatterGen.js; pure, so it runs on worker threads.
//
// Per instance, 8 floats: species index, variant, x and z within the cell, ground y, scale, yaw,
// and a random 0..1 for distance thinning and tinting (for rocks: biome index + 0..0.5).
public static class ScatterGen
{
	public const int Cell = 64;
	public const int Stride = 8;

	public enum Solid { None, Ball, Trunk, TrunkWide, Stump, Log }
	public enum Lod1 { None, Mesh, Impostor }

	public sealed class Species
	{
		public string Id;
		public int Variants;
		// only drawn this many cell rings out (0: out to the trees' reach)
		public int Near;
		// what stands in further out
		public Lod1 Lod1;
		// trees: a coarser model out to this many rings before the cards
		public int Mid;
		// instances per 1000 m² by biome (Biome order)
		public double[] Dens = new double[9];
		// reeds: density in the band along the water instead
		public double Shore;
		public double Scale0, Scale1;
		public bool Rock, Shadow = true, Snow;
		public string Sway;
		public Solid Solid;
		// noise threshold that groups them (groves, meadows); null for an even sprinkle
		public double? Cluster;
		// steepest ground (normal y) they grow on
		public double Slope = 0.86;
		// trees: reach as a fraction of the trees' radius
		public double Far = 1;
		public Func<WorldGen, double, double, double, bool> Place;
	}

	static Species S(string id, int variants, string dens, double s0, double s1, Action<Species> more = null)
	{
		var s = new Species { Id = id, Variants = variants, Scale0 = s0, Scale1 = s1 };
		foreach (var part in dens.Split(' ', StringSplitOptions.RemoveEmptyEntries))
		{
			var kv = part.Split(':');
			s.Dens[(int)Enum.Parse<Biome>(kv[0], true)] = double.Parse(kv[1], System.Globalization.CultureInfo.InvariantCulture);
		}
		more?.Invoke(s);
		return s;
	}

	public static readonly Species[] Table =
	{
		S("grass", 4, "scrub:165 dunes:16 badlands:34 saltflat:0.8 highland:85", 1.0, 1.9, s => { s.Near = 2; s.Sway = "grass"; s.Shadow = false; s.Cluster = -0.25; }),
		S("meadow", 4, "prairie:330 forest:45 highland:14", 1.0, 1.7, s => { s.Near = 2; s.Sway = "grass"; s.Shadow = false; s.Cluster = -0.45; }),
		S("snowgrass", 3, "taiga:60 tundra:85", 0.8, 1.4, s => { s.Near = 2; s.Sway = "grass"; s.Shadow = false; s.Cluster = -0.2; }),
		S("shrub", 4, "scrub:30 dunes:6 badlands:11 saltflat:0.3 highland:17 prairie:4.5", 0.6, 1.7, s => { s.Near = 4; s.Lod1 = Lod1.Mesh; s.Sway = "shrub"; s.Cluster = -0.15; }),
		S("yucca", 3, "scrub:1.4 dunes:0.5 badlands:0.5 highland:2.2 prairie:0.3", 0.8, 1.3, s => { s.Near = 3; s.Cluster = -0.05; }),
		S("tundrashrub", 3, "tundra:15 taiga:6", 0.8, 1.6, s => { s.Near = 3; s.Lod1 = Lod1.Mesh; s.Cluster = -0.25; }),
		S("fern", 3, "forest:34", 0.8, 1.5, s => { s.Near = 2; s.Sway = "shrub"; s.Shadow = false; s.Cluster = -0.2; }),
		S("flowers", 4, "prairie:26 forest:3 highland:1.5", 0.8, 1.3, s => { s.Near = 2; s.Sway = "grass"; s.Shadow = false; s.Cluster = 0.05; }),
		S("reeds", 3, "", 0.8, 1.3, s => { s.Near = 2; s.Shore = 260; s.Sway = "grass"; s.Shadow = false; }),
		S("pebble", 3, "scrub:2 dunes:0.3 badlands:5 saltflat:0.2 highland:7 prairie:0.8 forest:1 taiga:1.2 tundra:3.5", 0.12, 0.35, s => { s.Near = 2; s.Rock = true; s.Shadow = false; }),
		S("barrel", 2, "scrub:0.4 dunes:0.05 badlands:0.6 highland:0.2", 0.8, 1.3, s => { s.Near = 3; }),
		S("boulder", 4, "scrub:0.25 dunes:0.04 badlands:1.1 saltflat:0.02 highland:1.6 prairie:0.05 forest:0.12", 0.6, 2.2, s => { s.Lod1 = Lod1.Mesh; s.Rock = true; s.Solid = Solid.Ball; }),
		S("mossrock", 3, "forest:0.6 prairie:0.12 taiga:0.3 tundra:0.15", 0.6, 2.0, s => { s.Lod1 = Lod1.Mesh; s.Rock = true; s.Solid = Solid.Ball; }),
		S("snowrock", 3, "taiga:0.8 tundra:1.6", 0.6, 2.4, s => { s.Lod1 = Lod1.Mesh; s.Rock = true; s.Solid = Solid.Ball; }),
		S("slab", 3, "scrub:0.1 dunes:0.02 badlands:0.4 saltflat:0.01 highland:0.5 tundra:0.15", 0.8, 2.4, s => { s.Lod1 = Lod1.Mesh; s.Rock = true; s.Solid = Solid.Ball; }),
		S("saguaro", 3, "scrub:0.3 dunes:0.05 badlands:0.35 highland:0.12", 0.85, 1.25, s => { s.Lod1 = Lod1.Impostor; s.Solid = Solid.Trunk; s.Cluster = -0.1; }),
		S("ocotillo", 3, "scrub:0.16 badlands:0.22 highland:0.1", 0.85, 1.2, s => { s.Lod1 = Lod1.Impostor; s.Cluster = 0.0; }),
		S("joshua", 3, "scrub:0.34 dunes:0.01 badlands:0.05 highland:0.55", 0.9, 1.5, s => { s.Lod1 = Lod1.Impostor; s.Solid = Solid.Trunk; s.Cluster = -0.1; }),
		S("deadtree", 3, "scrub:0.05 dunes:0.02 badlands:0.06 saltflat:0.01 highland:0.1 prairie:0.02 taiga:0.1 tundra:0.2", 0.8, 1.4, s => { s.Lod1 = Lod1.Impostor; s.Solid = Solid.Trunk; }),
		// hoodoos: only in groups at the feet of the mesas, well off the road
		S("hoodoo", 3, "badlands:0.9", 0.7, 1.5, s =>
		{
			s.Lod1 = Lod1.Mesh;
			s.Rock = true;
			s.Solid = Solid.TrunkWide;
			s.Place = (gen, x, z, dRoad) =>
			{
				if (dRoad < 120) return false;
				double mm = gen.MesaNoise(x, z);
				return mm > 0.17 && mm < 0.29;
			};
		}),
		S("pine", 4, "forest:20 prairie:0.45 highland:0.25", 0.8, 1.25, s => { s.Mid = 3; s.Lod1 = Lod1.Impostor; s.Sway = "tree"; s.Solid = Solid.Trunk; s.Cluster = -0.15; s.Slope = 0.78; s.Far = 0.85; }),
		S("snowpine", 4, "taiga:13 tundra:1.3", 0.7, 1.25, s => { s.Mid = 3; s.Lod1 = Lod1.Impostor; s.Snow = true; s.Sway = "tree"; s.Solid = Solid.Trunk; s.Cluster = -0.2; s.Slope = 0.78; s.Far = 0.85; }),
		S("birch", 3, "forest:3.4 prairie:0.6", 0.85, 1.2, s => { s.Mid = 3; s.Lod1 = Lod1.Impostor; s.Sway = "tree"; s.Solid = Solid.Trunk; s.Cluster = 0.1; }),
		// birch groves in the snow: white trunks in stands among the spruce, alone out on the tundra
		S("birchbare", 3, "taiga:4 tundra:1.5", 0.85, 1.25, s => { s.Mid = 3; s.Lod1 = Lod1.Impostor; s.Snow = true; s.Solid = Solid.Trunk; s.Cluster = 0.2; }),
		S("stump", 3, "forest:0.8 taiga:1 tundra:0.2", 0.8, 1.3, s => { s.Near = 3; s.Solid = Solid.Stump; }),
		S("log", 3, "forest:0.35 taiga:0.6 tundra:0.15", 0.9, 1.2, s => { s.Near = 3; s.Solid = Solid.Log; }),
	};

	public static int IndexOf(string id) => Array.FindIndex(Table, s => s.Id == id);

	static readonly (int dx, int dz)[] EdgeProbe = { (3, 0), (-3, 0), (0, 3), (0, -3), (5, 5), (-5, -5) };

	// Deterministic instances for one cell (global cell indices).
	public static float[] CellInstances(WorldGen gen, int ci, int cj)
	{
		var out_ = new List<float>(256);
		double x0 = ci * (double)Cell, z0 = cj * (double)Cell;
		double cx = x0 + Cell / 2.0, cz = z0 + Cell / 2.0;
		var bw = gen.BiomeWeights(cx, cz, new double[9]);
		int biomeIdx = 0;
		double topW = -1;
		for (int b = 0; b < 9; b++)
			if (bw[b] > topW)
			{
				topW = bw[b];
				biomeIdx = b;
			}
		var rnd = Hash.Mulberry32(Hash.Ints(gen.Seed, ci, cj, 77));
		var pois = gen.PoisNear(cz, 1);
		// the shore band for reeds: only if a river or lake is close to this cell
		var water = gen.WaterAt(cx, cz);
		var rv = gen.RiverAt(cx, cz);
		var lakes = gen.LakesNear(cz, 1);
		bool nearWater = water != null || (rv != null && !rv.Value.R.Dry && rv.Value.D < rv.Value.R.W + Cell);
		if (!nearWater)
			foreach (var l in lakes)
			{
				double ldx = l.X - x0 - Cell / 2.0, ldz = l.Z - z0 - Cell / 2.0;
				if (Math.Sqrt(ldx * ldx + ldz * ldz) < Math.Max(l.Rx, l.Rz) + Cell) nearWater = true;
			}
		double bDry = bw[(int)Biome.Dunes] + bw[(int)Biome.Saltflat] + bw[(int)Biome.Badlands];
		double bCold = bw[(int)Biome.Taiga] + bw[(int)Biome.Tundra];
		for (int si = 0; si < Table.Length; si++)
		{
			var def = Table[si];
			double dens = 0;
			for (int b = 0; b < 9; b++) dens += def.Dens[b] * bw[b];
			if (def.Shore > 0 && nearWater) dens = def.Shore * (1 - bDry * 0.9) * (1 - bCold * 0.7);
			if (dens <= 0) continue;
			double expected = dens * Cell * Cell / 1000;
			int n = (int)Math.Floor(expected);
			if (rnd() < expected - n) n++;
			bool solid = def.Solid != Solid.None;
			for (int i = 0; i < n; i++)
			{
				double x = x0 + rnd() * Cell, z = z0 + rnd() * Cell;
				double r1 = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd();
				// clustering: groves, clearings and patches instead of an even sprinkle
				if (def.Cluster != null)
				{
					double f = def.Sway == "tree" ? 0.011 : 0.03;
					if (gen.NC.Noise2(x * f, z * f) < def.Cluster.Value + r3 * 0.2) continue;
				}
				double dRoad = gen.RoadDist(x, z);
				if (dRoad < WorldGen.RoadHalfWidth + WorldGen.RoadShoulder + (solid ? 6 : 1.5)) continue;
				var tn = gen.TrackNear(x, z);
				if (tn != null && tn.Value.d < WorldGen.TrackHalfWidth + WorldGen.TrackShoulder + (solid ? 4 : 0.8)) continue;
				if (def.Place != null && !def.Place(gen, x, z, dRoad)) continue;
				bool blocked = false;
				foreach (var p in pois)
				{
					double pdx = x - p.X, pdz = z - p.Z;
					if (Math.Sqrt(pdx * pdx + pdz * pdz) < p.PadR + (solid ? 8 : 2)) blocked = true;
				}
				if (blocked) continue;
				if (def.Shore > 0)
				{
					// reeds: in the band just outside the water's edge
					if (gen.WaterAt(x, z) != null) continue;
					bool edge = false;
					foreach (var (dx, dz) in EdgeProbe)
						if (gen.WaterAt(x + dx, z + dz) != null) edge = true;
					if (!edge) continue;
				}
				else if (nearWater && gen.WaterAt(x, z) != null) continue;
				double y = gen.Height(x, z);
				if (!def.Rock)
				{
					var nrm = gen.Normal(x, z, 1.0);
					if (nrm.y < def.Slope) continue;
				}
				double s = def.Scale0 + (def.Scale1 - def.Scale0) * r1 * r1;
				out_.Add(si);
				out_.Add((float)Math.Floor(r2 * def.Variants));
				out_.Add((float)(x - x0));
				out_.Add((float)y);
				out_.Add((float)(z - z0));
				out_.Add((float)s);
				out_.Add((float)(rnd() * Math.PI * 2));
				out_.Add((float)(def.Rock ? biomeIdx + r4 * 0.5 : r4));
			}
		}
		return out_.ToArray();
	}

	// How far a model sinks into the ground (boulders sit in the soil rather than on it).
	public static double SinkOf(Species def, double s) => def.Rock ? s * 0.18 : 0.02;
}
