using System;
using System.Collections.Generic;
using DustRoad.Core;
using static DustRoad.Core.MathX;

namespace DustRoad.World;

public enum Biome { Scrub, Dunes, Badlands, Saltflat, Highland, Prairie, Forest, Taiga, Tundra }

public enum PoiType
{
	Homestead, GasStation, Motel, Diner, Houses, House, Ranch, WaterTower, RadioTower, Junkyard,
	Trailers, Outpost, Ruins, Camp, Wreck, Farm, Cabin, Church, Sawmill, Lodge, Lookout,
}

public enum Surface { Asphalt, Gravel, Dirt, Sand, Rock, Salt, Grass, Snow, SnowRoad }

public sealed class River
{
	public int K;
	public double Z0, W, Phase, Zr, Level;
	public bool Dry, Frozen;
}

public sealed class Lake
{
	public int K;
	public double X, Z, Rx, Rz, Rot, Phase, Level;
	public bool Frozen;
}

public sealed class LiftEvent
{
	public string Kind;
	public double H, R, P, Zs, Up, Down, Seed;
}

public sealed class WindSeg
{
	public string Type;
	public double L, A, Phase, Z0, Z1;
}

public sealed class Track
{
	public int T, Side;
	public double Z0, Z1, Len, D, Wob;
	public string BlockKind;
	public double BlockZ;
	public bool Blocked => BlockKind != null;
}

public sealed class Poi
{
	public int K, Side;
	public PoiType Type;
	public double Z, X, Y, Rot, Offset, PadR, PadBlend;
	public Biome Biome;
	public int Seed;
}

public struct RiverHit
{
	public double D, Level, Zc;
	public River R;
}

public struct WaterHit
{
	public double Level;
	public bool Frozen, IsLake;
}

// Deterministic world description: the road's line and profile, biomes, terrain height and ground
// materials. A port of web/src/world/worldGen.js: the same seed gives the same land, road and
// places. Not thread-safe (it caches as it goes): give each thread its own instance.
public sealed class WorldGen
{
	public const int BiomeCount = 9;
	public static readonly string[] BiomeNames = { "Sagebrush steppe", "Dune sea", "Red badlands", "Salt flats", "Stone highlands", "Grass prairie", "Pine forest", "Snowy taiga", "Frozen tundra" };
	public static readonly float[][] BiomeGround =
	{
		new[] { 0.56f, 0.47f, 0.36f }, new[] { 0.8f, 0.64f, 0.44f }, new[] { 0.62f, 0.43f, 0.32f },
		new[] { 0.86f, 0.84f, 0.8f }, new[] { 0.5f, 0.47f, 0.43f }, new[] { 0.52f, 0.53f, 0.36f },
		new[] { 0.42f, 0.42f, 0.32f }, new[] { 0.86f, 0.88f, 0.92f }, new[] { 0.84f, 0.86f, 0.9f },
	};
	public static readonly float[] BiomeShrubs = { 0.85f, 0.16f, 0.34f, 0.02f, 0.55f, 0.3f, 0, 0, 0.18f };

	static bool IsDesert(Biome b) => b <= Biome.Highland;
	static bool IsSnowy(Biome b) => b == Biome.Taiga || b == Biome.Tundra;

	public const double RiverSpacing = 4300;
	public const double LakeCell = 1700;
	public const double RoadHalfWidth = 3.6, RoadShoulder = 1.6, LaneMark = 0.12;
	public const double TrackHalfWidth = 2.4, TrackShoulder = 1.1, TrackEvery = 3400;
	const double WindSegLen = 2600;
	const double LiftCell = 16000;
	public const double BiomeCell = 2600;
	const double BiomeBlend = 450;
	public const double PoiSpacing = 620;

	static readonly Dictionary<PoiType, (double lo, double hi, double pad)> PoiInfo = new()
	{
		[PoiType.Homestead] = (24, 28, 30), [PoiType.GasStation] = (22, 26, 30), [PoiType.Motel] = (26, 34, 32),
		[PoiType.Diner] = (20, 26, 22), [PoiType.Houses] = (34, 50, 46), [PoiType.House] = (24, 42, 23),
		[PoiType.Ranch] = (42, 62, 40), [PoiType.WaterTower] = (18, 30, 12), [PoiType.RadioTower] = (30, 60, 14),
		[PoiType.Junkyard] = (24, 36, 26), [PoiType.Trailers] = (24, 40, 28), [PoiType.Outpost] = (30, 50, 26),
		[PoiType.Ruins] = (18, 40, 16), [PoiType.Camp] = (16, 30, 12), [PoiType.Wreck] = (6, 9, 6),
		[PoiType.Farm] = (36, 54, 42), [PoiType.Cabin] = (22, 36, 16), [PoiType.Church] = (24, 36, 26),
		[PoiType.Sawmill] = (30, 46, 36), [PoiType.Lodge] = (28, 44, 30), [PoiType.Lookout] = (24, 40, 12),
	};

	static readonly Dictionary<Biome, (PoiType t, double w)[]> PoiTable = new()
	{
		[Biome.Scrub] = new[] { (PoiType.GasStation, 3.0), (PoiType.House, 2.5), (PoiType.Houses, 1.6), (PoiType.Ranch, 1.6), (PoiType.Diner, 1.2), (PoiType.Motel, 1.0), (PoiType.WaterTower, 0.9), (PoiType.Trailers, 0.9), (PoiType.Camp, 0.6), (PoiType.Wreck, 1.0), (PoiType.RadioTower, 0.6) },
		[Biome.Dunes] = new[] { (PoiType.GasStation, 2.4), (PoiType.Camp, 1.4), (PoiType.Ruins, 1.2), (PoiType.Wreck, 1.6), (PoiType.Outpost, 0.7), (PoiType.Diner, 0.8), (PoiType.RadioTower, 0.8) },
		[Biome.Badlands] = new[] { (PoiType.GasStation, 2.2), (PoiType.Ruins, 1.6), (PoiType.House, 1.4), (PoiType.Motel, 1.1), (PoiType.Junkyard, 1.1), (PoiType.Outpost, 0.8), (PoiType.Wreck, 1.2), (PoiType.WaterTower, 0.8) },
		[Biome.Saltflat] = new[] { (PoiType.GasStation, 2.5), (PoiType.Diner, 1.4), (PoiType.Motel, 1.3), (PoiType.RadioTower, 1.0), (PoiType.Wreck, 1.5), (PoiType.Trailers, 0.8), (PoiType.Outpost, 0.6) },
		[Biome.Prairie] = new[] { (PoiType.GasStation, 2.6), (PoiType.Farm, 2.6), (PoiType.House, 1.6), (PoiType.Houses, 1.4), (PoiType.Church, 1.0), (PoiType.Diner, 1.0), (PoiType.Motel, 0.8), (PoiType.WaterTower, 0.8), (PoiType.Wreck, 0.9), (PoiType.Trailers, 0.5) },
		[Biome.Forest] = new[] { (PoiType.GasStation, 2.4), (PoiType.Cabin, 2.6), (PoiType.Sawmill, 1.4), (PoiType.Lookout, 1.0), (PoiType.House, 1.2), (PoiType.Church, 0.6), (PoiType.Camp, 1.0), (PoiType.Motel, 0.8), (PoiType.Wreck, 0.8) },
		[Biome.Taiga] = new[] { (PoiType.GasStation, 2.6), (PoiType.Cabin, 2.4), (PoiType.Lodge, 1.6), (PoiType.Sawmill, 1.0), (PoiType.Lookout, 0.8), (PoiType.Church, 0.6), (PoiType.Outpost, 0.8), (PoiType.Wreck, 0.8) },
		[Biome.Tundra] = new[] { (PoiType.GasStation, 2.8), (PoiType.Outpost, 1.4), (PoiType.Cabin, 1.4), (PoiType.Lodge, 1.0), (PoiType.RadioTower, 1.0), (PoiType.Ruins, 0.8), (PoiType.Wreck, 1.0) },
		[Biome.Highland] = new[] { (PoiType.GasStation, 2.4), (PoiType.House, 1.8), (PoiType.Houses, 1.2), (PoiType.Ranch, 1.0), (PoiType.WaterTower, 0.9), (PoiType.RadioTower, 1.0), (PoiType.Junkyard, 0.9), (PoiType.Camp, 0.8), (PoiType.Wreck, 1.0) },
	};

	public readonly int Seed;
	public readonly SimplexNoise NA, NB, NC;

	readonly Dictionary<int, Biome> _cells = new();
	readonly Dictionary<int, WindSeg> _wind = new();
	readonly Dictionary<int, LiftEvent> _lift = new();
	readonly Dictionary<int, Track> _tracks = new();
	readonly Dictionary<int, River> _rivers = new();
	readonly Dictionary<int, Lake> _lakes = new();
	readonly Dictionary<int, Poi> _poi = new();
	readonly Dictionary<long, double> _roadYCache = new();
	readonly Dictionary<long, double> _trackYCache = new();
	readonly double[] _rxK = new double[4096], _rxV = new double[4096];
	readonly List<double> _sPos = new() { 0 }, _sNeg = new() { 0 };
	readonly double[] _bw = new double[BiomeCount];
	readonly List<River> _riverList = new(5);
	readonly List<Lake> _lakeList = new(3);

	public WorldGen(int seed = 1234)
	{
		Seed = seed;
		NA = new SimplexNoise(seed);
		NB = new SimplexNoise(seed * 7.0 + 3);
		NC = new SimplexNoise(seed * 13.0 + 5);
		Array.Fill(_rxK, double.NaN);
	}

	double R(int a, int b) => Hash.H01(Seed, a, b);

	// ---------------------------------------------------------------- biomes
	// Biomes appear by distance north along Route 9: desert first, then grass and pine country,
	// then snow toward Haven. Weights per biome at a distance in km.
	static void BiomeOdds(double km, double[] o)
	{
		double Ramp(double a, double b, double v0, double v1) => v0 + (v1 - v0) * Clamp((km - a) / (b - a), 0, 1);
		double desert = km < 7 ? 1 : Ramp(7, 60, 1, 0);
		o[(int)Biome.Scrub] = desert * 1.1;
		o[(int)Biome.Dunes] = desert;
		o[(int)Biome.Badlands] = desert;
		o[(int)Biome.Saltflat] = desert * 0.6;
		o[(int)Biome.Highland] = desert * 0.9 + Ramp(30, 60, 0, 0.25) - Ramp(75, 105, 0, 0.25);
		o[(int)Biome.Prairie] = km < 6 ? 0 : Ramp(6, 20, 0.3, 1.1) - Ramp(55, 100, 0, 0.9);
		o[(int)Biome.Forest] = km < 9 ? 0 : Ramp(9, 30, 0.3, 1.2) - Ramp(85, 125, 0, 0.6);
		o[(int)Biome.Taiga] = km < 26 ? 0 : Ramp(26, 75, 0.25, 1.4);
		o[(int)Biome.Tundra] = km < 40 ? 0 : Ramp(40, 95, 0.2, 0.9);
	}

	Biome BiomeOfCell(int k)
	{
		if (!(k > 0)) return Biome.Scrub;
		// avoid repeating the previous cell's biome (walk forward from the last cached cell)
		int start = k - 1;
		while (start > 0 && !_cells.ContainsKey(start)) start--;
		for (int j = start + 1; j < k; j++) CellBiome(j);
		var prev = k - 1 > 0 ? CellBiome(k - 1) : Biome.Scrub;
		var odds = new double[BiomeCount];
		BiomeOdds(k * BiomeCell / 1000, odds);
		// no jump straight from sand to snow (or back): something green or stony in between
		bool desertPrev = IsDesert(prev) && prev != Biome.Highland, snowPrev = IsSnowy(prev);
		double tot = 0;
		Span<double> w = stackalloc double[BiomeCount];
		for (int b = 0; b < BiomeCount; b++)
		{
			double v = odds[b];
			var bb = (Biome)b;
			if (bb == prev) v = 0;
			if (desertPrev && IsSnowy(bb)) v = 0;
			if (snowPrev && IsDesert(bb) && bb != Biome.Highland) v = 0;
			w[b] = v > 0 ? v : 0;
			tot += w[b];
		}
		if (tot <= 0) return Biome.Scrub;
		double r = Hash.H01(Seed, k, 91) * tot;
		int last = 0;
		for (int b = 0; b < BiomeCount; b++)
		{
			if (w[b] <= 0) continue;
			last = b;
			r -= w[b];
			if (r <= 0) return (Biome)b;
		}
		return (Biome)last;
	}

	public Biome CellBiome(int k)
	{
		if (_cells.TryGetValue(k, out var b)) return b;
		b = BiomeOfCell(k);
		_cells[k] = b;
		return b;
	}

	// How snowy the ground is at (x, z): 0..1 (snow biomes, plus high ground in the north).
	public double SnowAt(double x, double z, double[] bw = null)
	{
		bw ??= BiomeWeights(x, z, new double[BiomeCount]);
		return Clamp(bw[(int)Biome.Taiga] + bw[(int)Biome.Tundra], 0, 1);
	}

	// Weights per biome at (x, z) into `o`.
	public double[] BiomeWeights(double x, double z, double[] o)
	{
		Array.Clear(o);
		double zz = z + NC.Noise2(x * 0.0009, z * 0.0004) * 260;
		int k = (int)Math.Floor(zz / BiomeCell);
		double f = zz - k * BiomeCell;
		var cur = CellBiome(k);
		if (f < BiomeBlend / 2 && k > -1000)
		{
			var prev = CellBiome(k - 1);
			double t = Smoothstep(-BiomeBlend / 2, BiomeBlend / 2, f);
			o[(int)prev] += 1 - t;
			o[(int)cur] += t;
		}
		else if (f > BiomeCell - BiomeBlend / 2)
		{
			var next = CellBiome(k + 1);
			double t = Smoothstep(BiomeCell - BiomeBlend / 2, BiomeCell + BiomeBlend / 2, f);
			o[(int)cur] += 1 - t;
			o[(int)next] += t;
		}
		else o[(int)cur] += 1;
		return o;
	}

	public Biome DominantBiome(double x, double z)
	{
		var w = BiomeWeights(x, z, new double[BiomeCount]);
		int best = 0;
		double bw = -1;
		for (int b = 0; b < BiomeCount; b++)
			if (w[b] > bw)
			{
				bw = w[b];
				best = b;
			}
		return (Biome)best;
	}

	// ---------------------------------------------------------------- road
	// Long sweeps across the country, and on top of them, stretch by stretch, the road's own
	// character: S-bends every few hundred metres on winding stretches, tighter ones up the passes.
	public double RoadX(double z)
	{
		// the terrain asks for whole rows of the same z: a small cache on the exact value
		int ci = (int)((uint)ToInt32(Math.Floor(z * 4)) & 4095);
		if (_rxK[ci] == z) return _rxV[ci];
		var n = NA;
		double x = n.Noise2(z * 0.00032, 7.1) * 240 + n.Noise2(z * 0.001, 3.3) * 55 + n.Noise2(z * 0.0028, 9.9) * 7;
		x += WindAt(z);
		// keep the start area straight-ish
		double s = Smoothstep(150, 900, Math.Abs(z));
		double v = x * s;
		_rxK[ci] = z;
		_rxV[ci] = v;
		return v;
	}

	public (double dx, double dz) RoadDir(double z)
	{
		const double e = 1;
		double dx = RoadX(z + e) - RoadX(z - e);
		double l = Math.Sqrt(dx * dx + 4 * e * e);
		return (dx / l, 2 * e / l);
	}

	// dx/dz of the road line at z.
	public double RoadSlope(double z) => RoadX(z + 0.5) - RoadX(z - 0.5);

	// Distance from (x, z) to the road measured across it (not along x: on a bend the two differ).
	public double RoadDist(double x, double z)
	{
		double sl = RoadSlope(z);
		return Math.Abs(x - RoadX(z)) / Math.Sqrt(1 + sl * sl);
	}

	// The stretch of road around segment s: calm (only the long sweeps), winding (S-bends every
	// 340-600 m), tight (every 220-340 m) or a pass (tight bends climbing onto high ground). The
	// bend radius never drops below what a car takes at a sensible speed.
	public WindSeg Wind(int s)
	{
		if (_wind.TryGetValue(s, out var w)) return w;
		double r(int i) => Hash.H01(Seed, s, 1701 + i);
		double zc = (s + 0.5) * WindSegLen;
		string type = "calm";
		if (s >= 1)
		{
			var ramp = RampNear(zc, 0);
			if (ramp != null && r(0) < 0.75) type = "pass";
			else type = r(1) < 0.26 ? "calm" : r(1) < 0.68 ? "winding" : "tight";
		}
		double[] P = type switch
		{
			"calm" => new[] { 0, 0, 0, 1e9 },
			"winding" => new[] { 340, 260, 30 + r(3) * 45, 75 },
			"tight" => new[] { 220, 120, 22 + r(3) * 30, 48 },
			_ => new[] { 240, 100, 28 + r(3) * 28, 40 },
		};
		double L = P[0] + r(2) * P[1];
		// (with a margin for the slow swell of the amplitude and the fades at the ends)
		double A = type == "calm" ? 0 : Math.Min(P[2], 0.8 * L * L / (4 * Math.PI * Math.PI * P[3]));
		w = new WindSeg { Type = type, L = L, A = A, Phase = r(4) * Math.PI * 2, Z0 = s * WindSegLen, Z1 = (s + 1) * WindSegLen };
		_wind[s] = w;
		return w;
	}

	public double WindAt(double z)
	{
		int s = (int)Math.Floor(z / WindSegLen);
		var w = Wind(s);
		if (w.A == 0) return 0;
		// a straight bit at either end, and calm water: no bends across a river or beside a lake
		double env = Smoothstep(w.Z0, w.Z0 + 420, z) * Smoothstep(w.Z1, w.Z1 - 420, z);
		if (env <= 0) return 0;
		env *= CalmWater(z);
		if (env <= 0) return 0;
		double a = w.A * (0.8 + 0.2 * NC.Noise2(z * 0.0007, 41.7));
		return a * env * Math.Sin((z - w.Z0) / w.L * Math.PI * 2 + w.Phase);
	}

	static double LakeOdds(Biome b) => b switch
	{
		Biome.Forest => 0.55, Biome.Taiga => 0.5, Biome.Tundra => 0.45, Biome.Prairie => 0.35, Biome.Highland => 0.15, _ => 0,
	};

	// 0 near a river crossing or a lake (where the road keeps straight), 1 elsewhere. Uses the
	// places' nominal positions only (they are worked out from the road, so not from this).
	double CalmWater(double z)
	{
		double k = 1;
		int kr = (int)JsRound(z / RiverSpacing);
		for (int i = kr - 1; i <= kr + 1; i++)
		{
			if (i <= 0) continue;
			double z0 = i * RiverSpacing + (Hash.H01(Seed, i, 301) - 0.5) * 1400;
			k *= Smoothstep(380, 760, Math.Abs(z - z0));
		}
		int kl = (int)JsRound(z / LakeCell);
		for (int i = kl - 1; i <= kl + 1; i++)
		{
			if (i <= 1) continue;
			double zl = i * LakeCell + (Hash.H01(Seed, i, 401) - 0.5) * 600;
			if (Math.Abs(z - zl) > 600) continue;
			var b = CellBiome((int)Math.Floor(zl / BiomeCell));
			if (Hash.H01(Seed, i, 402) >= LakeOdds(b)) continue;
			k *= Smoothstep(260, 600, Math.Abs(z - zl));
		}
		return k;
	}

	// ---------------------------------------------------------------- high ground
	// Every 16 km or so the land rises: onto a plateau the road climbs to and runs along for a few
	// kilometres, over a ridge it crosses at a saddle and drops down from, or down into a basin.
	// Grades on the road stay near 8%; away from the road the slopes are steeper and the crest
	// line wanders, so it reads as country, not as a ramp.
	public LiftEvent Lift(int j)
	{
		if (_lift.TryGetValue(j, out var e)) return e;
		double r(int i) => Hash.H01(Seed, j, 1801 + i);
		e = null;
		if (j >= 1 && r(0) < 0.85)
		{
			double k = r(1);
			string kind = k < 0.45 ? "plateau" : k < 0.78 ? "ridge" : "basin";
			double H = kind == "basin" ? -(70 + r(2) * 90) : kind == "ridge" ? 170 + r(2) * 210 : 120 + r(2) * 200;
			double R = Math.Max(1600, Math.Abs(H) * 1.333 / 0.08);
			double P = kind == "ridge" ? 150 + r(3) * 500 : 1800 + r(3) * 4200;
			double zs = j * LiftCell + 600 + r(4) * 1200;
			P = Math.Max(100, Math.Min(P, LiftCell - 2 * R - 1600));
			e = new LiftEvent { Kind = kind, H = H, R = R, P = P, Zs = zs, Up = zs + R / 2, Down = zs + R + P + R / 2, Seed = r(5) * 100 };
		}
		_lift[j] = e;
		return e;
	}

	// 0 -> 1 over t in 0..1 at a steady grade, eased in and out over the first and last quarter.
	static double RampEase(double t)
	{
		if (t <= 0) return 0;
		if (t >= 1) return 1;
		const double e = 0.25, a = 1 / (1 - e);
		if (t < e) return 0.5 * a * t * t / e;
		if (t > 1 - e) return 1 - 0.5 * a * (1 - t) * (1 - t) / e;
		return a * (t - e / 2);
	}

	// 1 on a climb or descent of the high ground, fading to 0 within 800 m of it (smooth in z).
	public double RampWeight(double z)
	{
		int j = (int)Math.Floor(z / LiftCell);
		double w = 0;
		for (int i = j - 1; i <= j; i++)
		{
			var e = Lift(i);
			if (e == null) continue;
			w = Math.Max(w, Smoothstep(e.R / 2 + 800, e.R / 2, Math.Abs(z - e.Up)));
			w = Math.Max(w, Smoothstep(e.R / 2 + 800, e.R / 2, Math.Abs(z - e.Down)));
		}
		return w;
	}

	// An event whose climb or descent is within `range` of z.
	public LiftEvent RampNear(double z, double range)
	{
		int j = (int)Math.Floor(z / LiftCell);
		for (int i = j - 1; i <= j; i++)
		{
			var e = Lift(i);
			if (e == null) continue;
			if (Math.Abs(z - e.Up) < e.R / 2 + range || Math.Abs(z - e.Down) < e.R / 2 + range) return e;
		}
		return null;
	}

	public double LiftAt(double x, double z)
	{
		int j = (int)Math.Floor(z / LiftCell);
		double h = 0, dRoad = -1;
		for (int i = j - 1; i <= j; i++)
		{
			var e = Lift(i);
			if (e == null || z < e.Zs - 6000 || z > e.Down + e.R + 6000) continue;
			if (dRoad < 0) dRoad = Math.Abs(x - RoadX(z));
			double q = dRoad / 1100;
			double near = Math.Exp(-(q * q));
			// the edge wanders across the country; steeper away from the road the road's ramp
			double zz = z + NB.Noise2(x * 0.00035 + e.Seed, 7.7) * 1400 * (1 - near * 0.8);
			double R = e.R * (0.45 + 0.55 * near);
			double t = RampEase((zz - e.Up) / R + 0.5) - RampEase((zz - e.Down) / R + 0.5);
			if (t == 0) continue;
			// the crest is higher off to the sides: the road takes the saddle
			double n = NC.Noise2(x * 0.0006 + e.Seed, 3.1);
			double H = e.H * (e.H > 0 ? 1 + (0.25 + 0.55 * Math.Abs(n)) * (1 - near) : 1 + 0.3 * n * (1 - near));
			h += H * t;
		}
		return h;
	}

	public double MacroHeight(double x, double z)
	{
		var n = NB;
		// hill country comes and goes along the way: long climbs and steep drops for the road
		// (calmer where the land is already climbing onto high ground: the grades would add up)
		double calm = 1 - 0.7 * RampWeight(z);
		double hilly = Smoothstep(-0.05, 0.45, NA.Noise2(z * 0.000085 + 40, 1.7)) * calm;
		double hills = hilly > 0 ? hilly * (n.Noise2(x * 0.0007 + 11, z * 0.0007 - 4) * 26 + n.Noise2(x * 0.0019 - 7, z * 0.0019 + 2) * 6) : 0;
		return (n.Noise2(x * 0.00045, z * 0.00045) * 26 + n.Noise2(x * 0.0012 + 31, z * 0.0012) * 7) * calm + hills + LiftAt(x, z);
	}

	// Distance along the road from z = 0 to z (for the road's texture: lane dashes keep their
	// length on bends). Integrated in 20 m steps, kept in a table.
	public double RoadS(double z)
	{
		const double Step = 20;
		var tab = z >= 0 ? _sPos : _sNeg;
		double dir = z >= 0 ? 1 : -1;
		int i = (int)Math.Floor(Math.Abs(z) / Step);
		while (tab.Count <= i + 1)
		{
			int k = tab.Count - 1;
			double a = dir * k * Step, b = dir * (k + 1) * Step, len = 0;
			for (int q = 0; q < 4; q++)
			{
				double z0 = a + (b - a) * q / 4, z1 = a + (b - a) * (q + 1) / 4;
				double dx = RoadX(z1) - RoadX(z0), dz = z1 - z0;
				len += Math.Sqrt(dx * dx + dz * dz);
			}
			tab.Add(tab[k] + len);
		}
		double f = (Math.Abs(z) - i * Step) / Step;
		return dir * Lerp(tab[i], tab[i + 1], f);
	}

	// ---------------------------------------------------------------- side tracks
	// Every few kilometres a dirt track may leave the highway, swing a few hundred metres out over
	// the open country (up and over whatever is there) and come back to it. On over half of them
	// the highway between their ends is blocked (trees down across it, a rockslide, a trailer on
	// its side) and the track is the way round.
	public Track TrackOf(int t)
	{
		if (_tracks.TryGetValue(t, out var res)) return res;
		double r(int i) => Hash.H01(Seed, t, 1401 + i);
		res = null;
		if (t >= 1 && r(0) < 0.85)
		{
			double len = 900 + r(1) * 700;
			double z0 = t * TrackEvery + (r(2) - 0.5) * 700;
			res = new Track { T = t, Z0 = z0, Z1 = z0 + len, Len = len, Side = r(3) < 0.5 ? -1 : 1, D = 130 + r(4) * 190, Wob = r(6) * 6.28 };
			bool blocked = z0 > 1800 && r(5) < 0.6;
			if (blocked)
			{
				double zb = z0 + len * 0.5 + (r(8) - 0.5) * len * 0.2;
				// what comes down depends on the country right there
				var bw = BiomeWeights(RoadX(zb), zb, new double[BiomeCount]);
				double wooded = bw[(int)Biome.Forest] + bw[(int)Biome.Taiga] + bw[(int)Biome.Tundra] * 0.6;
				double rocky = bw[(int)Biome.Highland] + bw[(int)Biome.Badlands] + bw[(int)Biome.Scrub] * 0.3;
				res.BlockKind = wooded > 0.45 ? "trees" : rocky > 0.45 || r(7) < 0.3 ? "rocks" : "trailer";
				res.BlockZ = zb;
			}
			// no fords, no lakes, nowhere near the start
			if (z0 < 1500) res = null;
			for (double z = z0; res != null && z <= z0 + len; z += 30)
			{
				double x = TrackX(res, z);
				if (WaterAt(x, z) != null || WaterAt(RoadX(z), z) != null) res = null;
				else
				{
					var rv = RiverAt(x, z);
					if (rv != null && rv.Value.D < rv.Value.R.W + 30) res = null;
				}
			}
			if (res != null && BridgeNear(res.Z0) != null && BridgeNear(res.Z1) != null) res = null;
		}
		_tracks[t] = res;
		return res;
	}

	// The track whose span contains z, if any.
	public Track TrackAt(double z)
	{
		int t0 = (int)Math.Floor(z / TrackEvery);
		for (int t = t0 + 1; t >= t0 - 1; t--)
		{
			var tr = TrackOf(t);
			if (tr != null && z > tr.Z0 && z < tr.Z1) return tr;
		}
		return null;
	}

	// Sideways offset of the track from the highway at z (0 at both junctions).
	public static double TrackOffset(Track tr, double z)
	{
		double u = (z - tr.Z0) / tr.Len;
		if (u <= 0 || u >= 1) return 0;
		double b = Math.Sin(Math.PI * u);
		return tr.Side * tr.D * b * (1 + 0.18 * Math.Sin(u * 9.4 + tr.Wob) * b);
	}

	public double TrackX(Track tr, double z) => RoadX(z) + TrackOffset(tr, z);

	// Along-track profile: the lie of the land, smoothed a little; the highway's level at the ends.
	// (Worked out at the whole metre, so it is the same whatever order it is asked in.)
	public double TrackY(Track tr, double z)
	{
		double zr = JsRound(z);
		long key = tr.T * 1_000_000L + (long)zr;
		if (_trackYCache.TryGetValue(key, out var c)) return c;
		double s = 0, w = 0;
		for (int k = -5; k <= 5; k++)
		{
			double zz = zr + k * 9;
			double g = Math.Exp(-(k * k) / 8.0);
			s += NaturalHeight(TrackX(tr, zz), zz) * g;
			w += g;
		}
		double u = (zr - tr.Z0) / tr.Len;
		double e = Smoothstep(0.02, 0.2, u) * Smoothstep(0.98, 0.8, u);
		double y = Lerp(RoadY(zr), s / w, e);
		if (_trackYCache.Count > 300000) _trackYCache.Clear();
		_trackYCache[key] = y;
		return y;
	}

	// Distance across the nearest track at (x, z) and the track, or null.
	public (double d, Track tr)? TrackNear(double x, double z)
	{
		var tr = TrackAt(z);
		if (tr == null) return null;
		const double e = 1;
		double sl = (TrackX(tr, z + e) - TrackX(tr, z - e)) / (2 * e);
		double d = Math.Abs(x - TrackX(tr, z)) / Math.Sqrt(1 + sl * sl);
		return (d, tr);
	}

	// Is the highway blocked at z? (where the obstacle of a detour stands)
	public Track BlockAt(double z, double margin = 0)
	{
		var tr = TrackAt(z);
		return tr != null && tr.Blocked && Math.Abs(z - tr.BlockZ) < 14 + margin ? tr : null;
	}

	// Road elevation: Gaussian-smoothed macro height sampled along the road. Kept on a half-metre
	// grid and interpolated between (the same at any z whatever was asked before, and smooth).
	public double RoadY(double z)
	{
		double q = z * 2;
		double k0 = Math.Floor(q);
		double a = RoadYAt(k0), b = RoadYAt(k0 + 1);
		return a + (b - a) * (q - k0);
	}

	double RoadYAt(double k)
	{
		long key = (long)k;
		if (_roadYCache.TryGetValue(key, out var c)) return c;
		double z = k / 2, s = 0, w = 0;
		for (int i = -8; i <= 8; i++)
		{
			double zz = z + i * 22;
			double g = Math.Exp(-(i * i) / 18.0);
			s += MacroHeight(RoadX(zz), zz) * g;
			w += g;
		}
		double y = s / w;
		if (_roadYCache.Count > 200000) _roadYCache.Clear();
		_roadYCache[key] = y;
		return y;
	}

	// Road condition 0 (fresh) .. 1 (broken), dirt sections flagged.
	public (bool dirt, double wear, double snow) RoadInfo(double z)
	{
		int seg = (int)Math.Floor(z / 900);
		double h = Hash.H01(Seed, seg, 17);
		var biome = CellBiome((int)Math.Floor(z / BiomeCell));
		bool dirt = seg > 2 && h < (biome == Biome.Badlands || biome == Biome.Highland || biome == Biome.Forest ? 0.16 : 0.06);
		double wear = Clamp(0.25 + 0.6 * Hash.H01(Seed, seg, 23) + 0.15 * NA.Noise2(z * 0.01, 1.7), 0, 1);
		double snow = SnowAt(RoadX(z), z);
		return (dirt, wear, snow);
	}

	// ---------------------------------------------------------------- terrain
	// Dry washes draining across the plain toward the road (shallow, meandering).
	double Wash(double x, double z)
	{
		double w = Math.Abs(NB.Noise2(x * 0.0006 + NC.Noise2(x * 0.003, z * 0.003) * 0.25, z * 0.0019 + 5));
		return -1.3 * (1 - Smoothstep(0.0, 0.045, w));
	}

	// Ground shape per biome. dx: distance from the road. The country along the road is mostly calm
	// (plains, long swells, washes); the bolder shapes (dune fields, mesas, wooded hills) stand
	// further back, and how hilly it gets changes from region to region.
	public double BiomeDetail(Biome b, double x, double z, double dx)
	{
		var n = NB;
		var m = NC;
		double back = Smoothstep(60, 520, dx);
		double hilly = Smoothstep(-0.25, 0.45, NA.Noise2(z * 0.00009 + 4, x * 0.00009 - 2));
		switch (b)
		{
			case Biome.Dunes:
			{
				// sand sheet by the road, an erg further out: transverse dunes across the wind (+x) with
				// a long gentle windward slope and a short steep slip face, broken into crescents
				double sheet = n.Noise2(x * 0.0012, z * 0.0012) * 1.6 + n.Noise2(x * 0.006, z * 0.006) * 0.25;
				double field = Smoothstep(-0.85, -0.25, m.Noise2(x * 0.00032 + 11, z * 0.00032)) * Smoothstep(16, 50, dx) * (0.35 + 0.65 * Smoothstep(50, 280, dx));
				if (field <= 0) return sheet;
				const double lambda = 130;
				double warp = m.Noise2(x * 0.0009, z * 0.0017) * 38 + n.Noise2(x * 0.00035, z * 0.0004) * 150;
				double ph = (x + warp) / lambda;
				double saw = ph - Math.Floor(ph);
				double prof = saw < 0.76 ? Math.Pow(saw / 0.76, 1.35) : 0.5 + 0.5 * Math.Cos((saw - 0.76) / 0.24 * Math.PI);
				double crest = Smoothstep(-0.45, 0.2, n.Noise2(x * 0.0018 + 3, z * 0.0024));
				double H = 8 + 16 * (m.Noise2(x * 0.0009 + 7, z * 0.0009) * 0.5 + 0.5);
				double draa = (n.Noise2(x * 0.0007 + 9, z * 0.0007) * 0.5 + 0.5) * 9;
				return sheet + field * (prof * crest * H + draa);
			}
			case Biome.Badlands:
			{
				// flats and washes by the road; mesas and buttes with terraced cliffs further back
				double flat = n.Noise2(x * 0.0013, z * 0.0013) * 2.2 + Wash(x, z);
				double mm = MesaNoise(x, z);
				// each mesa its own height; terraced cliffs over a talus apron
				double top = 22 + 26 * (m.Noise2(x * 0.0011 - 5, z * 0.0011 + 8) * 0.5 + 0.5);
				double h = Smoothstep(0.28, 0.42, mm) * top;
				double step = 5.5 + 2.5 * (n.Noise2(x * 0.0017, z * 0.0017 + 2) * 0.5 + 0.5);
				double tq = Math.Floor(h / step);
				double fr = h / step - tq;
				h = (tq + Smoothstep(0.55, 1.0, fr)) * step;
				double talus = Math.Pow(Smoothstep(0.12, 0.3, mm), 1.6) * (5 + 0.12 * top);
				// erosion notches and gullies cut into the cliff faces
				double notch = Math.Pow(1 - Math.Abs(n.Noise2(x * 0.016 + 3, z * 0.016)), 6) * 7 * Smoothstep(0.26, 0.31, mm) * (1 - Smoothstep(0.35, 0.42, mm));
				double gully = Math.Abs(n.Noise2(x * 0.01, z * 0.01)) * 2.2;
				// low rounded clay hills, banded, in patches closer in
				double cp = Smoothstep(0.05, 0.4, m.Noise2(x * 0.0016 + 21, z * 0.0016 - 9));
				double clay = Math.Pow(Math.Max(0, n.Noise2(x * 0.011 + 6, z * 0.011 - 1) - 0.15) / 0.85, 1.4) * 10 * cp * Smoothstep(35, 140, dx);
				return flat + clay + Math.Max(0, Math.Max(h, talus) - gully - notch) * Smoothstep(140, 600, dx);
			}
			case Biome.Saltflat:
				return n.Noise2(x * 0.003, z * 0.003) * 0.35;
			case Biome.Highland:
			{
				// high desert plateau: long swells, rocky knolls and a butte now and then
				double swell = n.Noise2(x * 0.0011 + 2, z * 0.0011) * 6 + n.Noise2(x * 0.004, z * 0.004) * 1.2;
				double knoll = Math.Pow(Math.Max(0, n.Noise2(x * 0.0045 + 5, z * 0.0045) - 0.35) / 0.65, 1.6) * 22;
				return swell + Wash(x, z) + knoll * back * (0.4 + 0.6 * hilly);
			}
			case Biome.Prairie:
				// long gentle swells
				return (n.Noise2(x * 0.0018 + 7, z * 0.0018) * 7 + n.Noise2(x * 0.007, z * 0.007 + 3) * 1.4) * (0.45 + 0.55 * back) + n.Noise2(x * 0.04, z * 0.04) * 0.15;
			case Biome.Forest:
			{
				// wooded hills with soft ridges, a broad valley along the road
				double r = 1 - Math.Abs(n.Noise2(x * 0.0032 + 3, z * 0.0032 - 2));
				return (r * r * 18 * (0.3 + 0.7 * hilly) - 5) * (0.25 + 0.75 * back) + n.Noise2(x * 0.012, z * 0.012) * 2.2 + n.Noise2(x * 0.05, z * 0.05) * 0.3;
			}
			case Biome.Taiga:
			{
				// hills that rise away from the road valley
				double away = Smoothstep(40, 380, dx);
				double r = 1 - Math.Abs(n.Noise2(x * 0.0022 - 9, z * 0.0022 + 4));
				double r2 = 1 - Math.Abs(n.Noise2(x * 0.0068, z * 0.0068 + 8));
				return (r * r * 40 + r2 * r2 * 8) * (0.2 + 0.8 * away) + n.Noise2(x * 0.02, z * 0.02) * 0.8 - 8;
			}
			case Biome.Tundra:
			{
				// open, gently rolling, with frost hummocks
				double hum = Math.Max(0, n.Noise2(x * 0.09, z * 0.09)) * 0.45;
				return n.Noise2(x * 0.003 + 1, z * 0.003) * 4 + n.Noise2(x * 0.011, z * 0.011) * 1.1 + hum;
			}
			default:
			{
				// scrub: open desert plain sloping gently off the ranges, washes, low hills further out
				double plain = n.Noise2(x * 0.0011, z * 0.0011) * 3.5 + n.Noise2(x * 0.004, z * 0.004) * 0.6 + n.Noise2(x * 0.05, z * 0.05) * 0.12;
				double hills = Math.Pow(1 - Math.Abs(n.Noise2(x * 0.0024 + 9, z * 0.0024)), 2.5) * 16;
				return plain + Wash(x, z) + hills * back * hilly;
			}
		}
	}

	// Slow colour drift of the ground, as a per-channel multiplier: a few hundred metres of redder
	// soil, then yellower, then a greyer, darker stretch, so a plain is never one flat colour.
	public (double r, double g, double b) TintDrift(double x, double z)
	{
		double a = NC.Noise2(x * 0.0014 + 31, z * 0.0014 - 7);
		double b = NA.Noise2(x * 0.0006 - 13, z * 0.0006 + 29);
		double c = NB.Noise2(x * 0.0035 + 5, z * 0.0035 + 17) * 0.5;
		double red = a * 0.09, grey = Math.Max(0, b) * 0.14, v = 1 + c * 0.12 - grey * 0.5;
		return ((1 + red - grey * 0.3) * v, (1 - red * 0.2 + a * a * 0.04) * v, (1 - red * 0.9 + grey * 0.35) * v);
	}

	// Badlands mesa field: the tops stand where this is above ~0.28; just below it lie their feet.
	public double MesaNoise(double x, double z) => NB.Noise2(x * 0.0021 + 11, z * 0.0021 - 4) + 0.35 * NB.Noise2(x * 0.006, z * 0.006);

	// Natural (unroaded) ground height.
	public double NaturalHeight(double x, double z, double[] bw = null)
	{
		bw ??= BiomeWeights(x, z, _bw);
		double d = 0;
		double dx = Math.Abs(x - RoadX(z));
		for (int b = 0; b < BiomeCount; b++)
			if (bw[b] > 0.001) d += bw[b] * BiomeDetail((Biome)b, x, z, dx);
		return MacroHeight(x, z) + d + Mountain(x, z, bw);
	}

	// Value noise with its analytic derivatives: (value -1..1, d/dx, d/dy).
	static double LatticeHash(int ix, int iy, int seed)
	{
		uint h = unchecked((uint)(ix * 0x27d4eb2d) ^ (uint)(iy * 0x165667b1) ^ (uint)seed);
		h = (h ^ (h >> 15)) * 0x85ebca6b;
		h = (h ^ (h >> 13)) * 0xc2b2ae35;
		return (h ^ (h >> 16)) / 2147483648.0 - 1;
	}

	static void Noised(double x, double y, int seed, out double v, out double dvx, out double dvy)
	{
		double fix = Math.Floor(x), fiy = Math.Floor(y);
		int ix = (int)fix, iy = (int)fiy;
		double fx = x - fix, fy = y - fiy;
		double ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
		double dux = 30 * fx * fx * (fx * (fx - 2) + 1), duy = 30 * fy * fy * (fy * (fy - 2) + 1);
		double a = LatticeHash(ix, iy, seed), b = LatticeHash(ix + 1, iy, seed), c = LatticeHash(ix, iy + 1, seed), d = LatticeHash(ix + 1, iy + 1, seed);
		double k1 = b - a, k2 = c - a, k4 = a - b - c + d;
		v = a + k1 * ux + k2 * uy + k4 * ux * uy;
		dvx = dux * (k1 + k4 * uy);
		dvy = duy * (k2 + k4 * ux);
	}

	// Mountain relief: fBm whose every octave is damped where the octaves below are steep. Ridges
	// stay sharp, valley floors smooth out and gullies run down the flanks, the way water and frost
	// shape real ranges. Returns about 0..1.
	static double ErodedFbm(double x, double y, int seed, int octaves = 9)
	{
		double a = 0, b = 0.5, dx = 0, dy = 0, px = x, py = y;
		for (int i = 0; i < octaves; i++)
		{
			Noised(px, py, seed + i * 1013, out var nv, out var nx, out var ny);
			dx += nx;
			dy += ny;
			a += b * (nv * 0.5 + 0.5) / (1 + dx * dx + dy * dy);
			b *= 0.5;
			// rotate and double: no octave lines up with the one below
			double qx = 1.6 * px - 1.2 * py, qy = 1.2 * px + 1.6 * py;
			px = qx;
			py = qy;
		}
		return a;
	}

	// Mountain ranges standing back from the road: ridged peaks a few hundred metres high that
	// come and go along the way, now and then crowding in so the road runs up a valley between
	// them. Rivers cut their own valleys through.
	public double Mountain(double x, double z, double[] bw = null)
	{
		double dx = Math.Abs(x - RoadX(z));
		var n = NA;
		double close = Smoothstep(0.3, 0.85, n.Noise2(z * 0.00027 + 17, 3.3) * 0.5 + 0.5);
		double start = 1300 - 750 * close;
		if (dx < start) return 0;
		// ranges: broad belts of high country, with gaps between them
		double range = Smoothstep(-0.5, 0.15, n.Noise2(x * 0.00017 + 5, z * 0.00017 - 9) + 0.3 * close);
		if (range <= 0) return 0;
		double mask = Smoothstep(start, start + 1000, dx) * range;
		foreach (var rv in RiversNear(z, 1))
		{
			if (Math.Abs(z - rv.Z0) > 1600) continue;
			mask *= Smoothstep(rv.W + 60, rv.W + 1100, Math.Abs(z - RiverZ(rv, x)));
		}
		if (mask <= 0.001) return 0;
		// ranges run with the road (long belts across the land, like basin-and-range country); the
		// eroded fBm on them makes the crests, spurs and gullies, flat between the ranges
		double belt = n.Noise2(x * 0.00034 + 3, z * 0.00011 - 1) + 0.3 * n.Noise2(x * 0.0009 + 7, z * 0.0007);
		double k = Smoothstep(-0.4, 0.3, belt) * mask;
		if (k <= 0.001) return 0;
		double e = ErodedFbm(x * 0.00052, z * 0.00052, Seed);
		double relief = Math.Pow(e / 0.45, 1.6);
		relief = 1.35 * Math.Tanh(relief / 1.35);
		// sharp ridges and the gullies between them, cut deeper the higher the ground stands
		var nr = NC;
		double r = 0, a = 0.5, wgt = 1, px = x * 0.0013, pz = z * 0.0013;
		for (int o = 0; o < 4; o++)
		{
			double v0 = 1 - Math.Abs(nr.Noise2(px + o * 17.3, pz - o * 9.1));
			v0 = v0 * v0 * (3 - 2 * v0);
			r += a * v0 * wgt;
			wgt = Math.Min(1, v0 * 1.4);
			a *= 0.5;
			double qx = 1.6 * px - 1.2 * pz;
			pz = 1.2 * px + 1.6 * pz;
			px = qx;
		}
		relief *= 0.6 + 0.85 * r * Smoothstep(0.06, 0.5, relief);
		bw ??= BiomeWeights(x, z, new double[BiomeCount]);
		double amp = 520 + bw[(int)Biome.Highland] * 380 + bw[(int)Biome.Taiga] * 450 + bw[(int)Biome.Saltflat] * 200 + bw[(int)Biome.Forest] * 150 - bw[(int)Biome.Prairie] * 150 - bw[(int)Biome.Dunes] * 260;
		// where the belt thins out the range sinks into the plain instead of shrinking: only its
		// crests and spurs stand out, full height in its middle. v^2/(v+w) eases the foot into the
		// flat; the last factor takes it to nothing at the belt's very edge
		double kk = k * k * (3 - 2 * k);
		double v = relief * (0.7 + 0.3 * kk) - (1 - kk) * 0.45;
		return v > 0 ? v * v / (v + 0.08) * amp * Math.Min(1, k * 8) : 0;
	}

	// ---------------------------------------------------------------- water
	// Rivers cross the road every few kilometres, meandering across the whole map. In the desert
	// most are dry washes.
	public River RiverOf(int k)
	{
		if (_rivers.TryGetValue(k, out var res)) return res;
		res = null;
		if (k > 0)
		{
			double z = k * RiverSpacing + (Hash.H01(Seed, k, 301) - 0.5) * 1400;
			var b = CellBiome((int)Math.Floor(z / BiomeCell));
			bool desert = IsDesert(b);
			double w = desert ? 5 + Hash.H01(Seed, k, 302) * 4 : 7 + Hash.H01(Seed, k, 302) * 7;
			res = new River { K = k, Z0 = z, W = w, Dry = desert && Hash.H01(Seed, k, 303) < 0.75, Frozen = IsSnowy(b), Phase = Hash.H01(Seed, k, 304) * 100 };
			res.Zr = RiverZ(res, RoadX(z));
			// the road crossing point: iterate to where the river meets the road line
			for (int i = 0; i < 10; i++) res.Zr = RiverZ(res, RoadX(res.Zr));
			res.Level = RoadY(res.Zr) - (res.Dry ? 2.2 : 4.2);
		}
		_rivers[k] = res;
		return res;
	}

	public double RiverZ(River r, double x) => r.Z0 + NA.Noise2(x * 0.0021 + r.Phase, 1.3) * 160 + NA.Noise2(x * 0.0075 + r.Phase, 4.1) * 30;

	public List<River> RiversNear(double z, int range = 2)
	{
		int k0 = (int)JsRound(z / RiverSpacing);
		var o = range == 1 ? _riverList : new List<River>();
		o.Clear();
		for (int k = k0 - range; k <= k0 + range; k++)
		{
			var r = RiverOf(k);
			if (r != null) o.Add(r);
		}
		return o;
	}

	// Nearest river at (x, z): distance across it, its water level there and the record.
	public RiverHit? RiverAt(double x, double z)
	{
		RiverHit? best = null;
		int k0 = (int)JsRound(z / RiverSpacing);
		for (int k = k0 - 1; k <= k0 + 1; k++)
		{
			var r = RiverOf(k);
			if (r == null) continue;
			// meanders stay within ~190 m of the river's nominal line
			if (Math.Abs(z - r.Z0) > 230 + r.W * 2) continue;
			double zc = RiverZ(r, x);
			const double e = 2;
			double slope = (RiverZ(r, x + e) - RiverZ(r, x - e)) / (2 * e);
			double d = Math.Abs(z - zc) / Math.Sqrt(1 + slope * slope);
			if (best != null && d >= best.Value.D) continue;
			// water level follows the land away from the road, and sits under the bridge near it
			double away = Smoothstep(60, 500, Math.Abs(x - RoadX(zc)));
			double far = MacroHeight(x, zc) - (r.Dry ? 2.2 : 3.6);
			best = new RiverHit { D = d, R = r, Level = Lerp(r.Level, far, away), Zc = zc };
		}
		return best;
	}

	// Lakes beside the road in green and snowy country.
	public Lake LakeOf(int k)
	{
		if (_lakes.TryGetValue(k, out var res)) return res;
		res = null;
		if (k > 1)
		{
			double z = k * LakeCell + (Hash.H01(Seed, k, 401) - 0.5) * 600;
			var b = CellBiome((int)Math.Floor(z / BiomeCell));
			if (Hash.H01(Seed, k, 402) < LakeOdds(b))
			{
				int side = Hash.H01(Seed, k, 403) < 0.5 ? -1 : 1;
				double rx = 45 + Hash.H01(Seed, k, 404) * 70;
				double rz = rx * (0.7 + Hash.H01(Seed, k, 405) * 0.9);
				double off = rx + 35 + Hash.H01(Seed, k, 406) * 160;
				double cx = RoadX(z) + side * off;
				res = new Lake { K = k, X = cx, Z = z, Rx = rx, Rz = rz, Rot = Hash.H01(Seed, k, 407) * Math.PI, Frozen = IsSnowy(b), Phase = Hash.H01(Seed, k, 408) * 50 };
				res.Level = MacroHeight(cx, z) + BiomeDetail(b, cx, z, Math.Abs(cx - RoadX(z))) * 0.4 - 1.2;
				// no lake on the flank of a climb (its basin would be a step in the slope), and none
				// the road would swing into
				double g = Math.Abs(LiftAt(cx, z + rz) - LiftAt(cx, z - rz)) / (2 * rz);
				if (g > 0.02) res = null;
				double ext = Math.Max(rx, rz) * 1.7;
				for (double zz = z - ext; res != null && zz <= z + ext; zz += 10)
					if (LakeDist(res, RoadX(zz), zz) < 1.3) res = null;
			}
		}
		_lakes[k] = res;
		return res;
	}

	public List<Lake> LakesNear(double z, int range = 1)
	{
		int k0 = (int)JsRound(z / LakeCell);
		var o = range == 1 ? _lakeList : new List<Lake>();
		o.Clear();
		for (int k = k0 - range; k <= k0 + range; k++)
		{
			var l = LakeOf(k);
			if (l != null) o.Add(l);
		}
		return o;
	}

	// Normalised elliptical distance from a lake's centre (1 = shoreline), with a wobbly shore.
	public static double LakeDist(Lake l, double x, double z)
	{
		double dx = x - l.X, dz = z - l.Z;
		double c = Math.Cos(l.Rot), s = Math.Sin(l.Rot);
		double u = (dx * c - dz * s) / l.Rx, v = (dx * s + dz * c) / l.Rz;
		double a = Math.Atan2(v, u);
		double wob = 1 + 0.16 * Math.Sin(a * 3 + l.Phase) + 0.08 * Math.Sin(a * 7 + l.Phase * 2);
		return Math.Sqrt(u * u + v * v) / wob;
	}

	// Water surface at (x, z), if any.
	public WaterHit? WaterAt(double x, double z)
	{
		var rv = RiverAt(x, z);
		if (rv != null && !rv.Value.R.Dry && rv.Value.D < rv.Value.R.W) return new WaterHit { Level = rv.Value.Level, Frozen = rv.Value.R.Frozen };
		foreach (var l in LakesNear(z, 1))
			if (Math.Abs(z - l.Z) < Math.Max(l.Rx, l.Rz) * 1.3 && LakeDist(l, x, z) < 1) return new WaterHit { Level = l.Level, Frozen = l.Frozen, IsLake = true };
		return null;
	}

	// Final ground height with road corridor, flattened POI pads, river valleys and lake basins.
	public double Height(double x, double z)
	{
		double h = BaseHeight(x, z);
		// river valley: banks slope down to a bed below the water line
		var rv = RiverAt(x, z);
		if (rv != null)
		{
			var r = rv.Value;
			double w = r.R.W, bank = 12 + w * 0.6;
			if (r.D < w + bank)
			{
				double t = Smoothstep(w + bank, w * 0.6, r.D);
				double q = Math.Min(r.D, w) / w;
				double bed = r.Level - (r.R.Dry ? 0.6 : 1.8) * (1 - q * q) + (r.D > w ? 0.35 : 0);
				h = Lerp(h, Math.Min(h, bed), t);
			}
		}
		// lake basins
		foreach (var l in LakesNear(z, 1))
		{
			double ext = Math.Max(l.Rx, l.Rz) * 1.9;
			if (Math.Abs(z - l.Z) > ext || Math.Abs(x - l.X) > ext) continue;
			double d = LakeDist(l, x, z);
			if (d < 1.5)
			{
				double t = Smoothstep(1.5, 0.92, d);
				double bed = l.Level - 2.8 * Math.Max(0, 1 - d * d) + Math.Max(0, d - 1) * 2.0 + 0.25;
				h = Lerp(h, Math.Min(h, bed), t);
			}
		}
		return h;
	}

	// Road deck height over a bridge (the road keeps its own profile across the water).
	public double RoadSurfaceY(double x, double z)
	{
		var rv = RiverAt(x, z);
		if (rv != null && rv.Value.D < rv.Value.R.W + 12 + rv.Value.R.W * 0.6) return RoadY(z) - Math.Max(0, Math.Abs(x - RoadX(z)) - RoadHalfWidth) * 0.07;
		return Height(x, z);
	}

	// Bridge on the road near z, if any: the river and the span along the road.
	public (River r, double z0, double z1)? BridgeNear(double z)
	{
		int k0 = (int)JsRound(z / RiverSpacing);
		for (int k = k0 - 1; k <= k0 + 1; k++)
		{
			var r = RiverOf(k);
			if (r == null) continue;
			double span = r.W + 12 + r.W * 0.6 + 4;
			if (Math.Abs(z - r.Zr) < span + 200) return (r, r.Zr - span, r.Zr + span);
		}
		return null;
	}

	public double BaseHeight(double x, double z)
	{
		double dx = RoadDist(x, z);
		double roadY = RoadY(z);
		const double flat = RoadHalfWidth + RoadShoulder;
		// on a POI pad the shoulder stays level and the ditch is filled, so forecourts and wrecks
		// beside the road sit on the ground instead of over a dip
		double pw = PadWeight(x, z);
		if (dx < flat) return roadY - Math.Max(0, dx - RoadHalfWidth) * 0.07 * (1 - pw);
		double n0 = NaturalHeight(x, z);
		double nat = n0 + PadOffset(x, z, n0);
		double diff = nat - roadY;
		double jag = NC.Noise2(x * 0.05, z * 0.05) * 2.5 + NC.Noise2(z * 0.011, x * 0.003) * 4;
		double width = 10 + jag + Math.Min(60, Math.Abs(diff) * 1.6);
		double t = Math.Max(Smoothstep(flat + Math.Max(0, jag * 0.3), flat + width, dx), pw * Smoothstep(flat, flat + 2.5, dx));
		double edge = roadY - RoadShoulder * 0.07 * (1 - pw) - 0.25 * Smoothstep(flat, flat + 3, dx) * (1 - t) * (1 - pw);
		double h = Lerp(edge, nat, t);
		// a dirt track cuts its own narrow bed through the land; the highway's corridor wins
		var tn = TrackNear(x, z);
		if (tn != null && tn.Value.d < 45)
		{
			double ty = TrackY(tn.Value.tr, z);
			const double tf = TrackHalfWidth + TrackShoulder;
			double tw = 5 + Math.Min(30, Math.Abs(h - ty) * 1.3);
			double tt = Smoothstep(tf, tf + tw, tn.Value.d);
			double keep = Smoothstep(flat + 0.3, flat + 6, dx);
			double tedge = ty - Math.Max(0, tn.Value.d - TrackHalfWidth) * 0.08;
			h = Lerp(h, tedge, (1 - tt) * keep);
		}
		return h;
	}

	// ---------------------------------------------------------------- POI planning
	// Points of interest sit in slots along the road. Each slot is deterministic from the seed.
	public Poi PoiSlot(int k) => _poi.TryGetValue(k, out var c) ? c : MakePoiSlot(k);

	// The entry the weighted pick lands on (`keep` if rounding leaves it short of every entry).
	static PoiType PickPoi((PoiType t, double w)[] table, double pick, PoiType keep)
	{
		foreach (var (t, w) in table)
		{
			pick -= w;
			if (pick <= 0) return t;
		}
		return keep;
	}

	Poi MakePoiSlot(int k)
	{
		if (_poi.TryGetValue(k, out var res)) return res;
		double r(int i) => Hash.H01(Seed, k, 501 + i);
		res = null;
		if (k == 0) res = new Poi { K = 0, Type = PoiType.Homestead, Side = 1, Z = 18, Offset = 26 };
		else if (k > 0 && r(0) < 0.92)
		{
			double z = k * PoiSpacing + (r(1) - 0.5) * PoiSpacing * 0.5;
			var biome = CellBiome((int)Math.Floor(z / BiomeCell));
			var table = PoiTable.TryGetValue(biome, out var tb) ? tb : PoiTable[Biome.Scrub];
			double tot = 0;
			foreach (var (_, w) in table) tot += w;
			var type = PickPoi(table, r(2) * tot, table[0].t);
			// avoid repeating recent types; guarantee fuel every few slots
			var p1 = PoiSlot(k - 1);
			var p2 = PoiSlot(k - 2);
			bool Recent(PoiType t) => (p1 != null && p1.Type == t) || (p2 != null && p2.Type == t);
			for (int tries = 0; Recent(type) && tries < 8; tries++) type = PickPoi(table, Hash.H01(Seed, k, 600 + tries) * tot, type);
			int sinceFuel = 0;
			for (int j = k - 1; j >= Math.Max(0, k - 6); j--)
			{
				var pj = PoiSlot(j);
				if (pj != null && pj.Type == PoiType.GasStation) break;
				sinceFuel++;
			}
			if (sinceFuel >= 5 && type != PoiType.GasStation) type = PoiType.GasStation;
			int side = r(3) < 0.5 ? -1 : 1;
			var info = PoiInfo[type];
			res = new Poi { K = k, Type = type, Side = side, Z = z, Offset = info.lo + r(4) * (info.hi - info.lo), Biome = biome };
		}
		if (res != null)
		{
			res.PadR = PoiInfo[res.Type].pad;
			res.PadBlend = 22;
			res.Seed = (int)Math.Floor(r(9) * 1e9);
			// keep the pad out of river valleys and lake basins: slide it along the road, or try the
			// other side, and give the slot up if neither works
			double along = res.Z;
			bool placed = false;
			int[] shifts = k == 0 ? new[] { 0 } : new[] { 0, 40, -40, 80, -80, 130, -130, 190, -190 };
			foreach (int shift in shifts)
			{
				// (from the side the last try left it on, as the browser version does)
				foreach (int side in new[] { res.Side, -res.Side })
				{
					PlacePoi(res, along + shift, side);
					if (k == 0 || (PoiClear(res.X, res.Z, res.PadR + res.PadBlend * 0.6) && PoiOnRoad(res, along + shift)))
					{
						placed = true;
						break;
					}
				}
				if (placed) break;
			}
			if (!placed) res = null;
		}
		_poi[k] = res;
		return res;
	}

	// The place sits beside a stretch of road it can stand on: not on a steep climb, and with the
	// road not bending back into its yard.
	bool PoiOnRoad(Poi res, double along)
	{
		if (Math.Abs(RoadY(along + 25) - RoadY(along - 25)) / 50 > 0.055) return false;
		double R = res.PadR + res.PadBlend * 0.6;
		double need = Math.Min(res.Offset, R) * 0.85;
		for (double dz = -R - 70; dz <= R + 70; dz += 6)
		{
			double zz = along + dz;
			double ex = res.X - RoadX(zz), ez = res.Z - zz;
			if (Math.Sqrt(ex * ex + ez * ez) < need) return false;
		}
		return true;
	}

	void PlacePoi(Poi res, double along, int side)
	{
		var (dx, dz) = RoadDir(along);
		// perpendicular (pointing to +x side of the road for side=+1)
		double px = dz, pz = -dx;
		res.Side = side;
		res.X = RoadX(along) + px * res.Offset * side;
		res.Z = along + pz * res.Offset * side;
		// face the road
		res.Rot = Math.Atan2(-px * side, -pz * side);
		res.Y = RoadY(res.Z) + 0.1;
	}

	// No river bank or lake basin within R metres of (x, z).
	bool PoiClear(double x, double z, double R)
	{
		// keep pads off the side tracks
		for (double dz = -R - 20; dz <= R + 20; dz += 10)
		{
			var tr = TrackAt(z + dz);
			if (tr != null && Math.Abs(x - TrackX(tr, z + dz)) < R + 14) return false;
		}
		var rv = RiverAt(x, z);
		if (rv != null && rv.Value.D < rv.Value.R.W + 12 + rv.Value.R.W * 0.6 + R) return false;
		foreach (var l in LakesNear(z, 1))
		{
			double ext = Math.Max(l.Rx, l.Rz) * 2 + R;
			if (Math.Abs(z - l.Z) > ext || Math.Abs(x - l.X) > ext) continue;
			// basin edge at normalised distance 1.5; convert the margin to metres with the short radius
			if ((LakeDist(l, x, z) - 1.5) * Math.Min(l.Rx, l.Rz) < R) return false;
		}
		return true;
	}

	public List<Poi> PoisNear(double z, int range = 1)
	{
		int k0 = (int)JsRound(z / PoiSpacing);
		var o = new List<Poi>();
		for (int k = k0 - range; k <= k0 + range; k++)
		{
			var p = PoiSlot(k);
			if (p != null) o.Add(p);
		}
		return o;
	}

	// 1 on a POI's level pad, fading to 0 across its blend ring.
	public double PadWeight(double x, double z)
	{
		int k0 = (int)JsRound(z / PoiSpacing);
		double w = 0;
		for (int k = k0 - 1; k <= k0 + 1; k++)
		{
			var p = PoiSlot(k);
			if (p == null) continue;
			double dx = x - p.X, dz = z - p.Z;
			double d = Math.Sqrt(dx * dx + dz * dz);
			if (d < p.PadR + p.PadBlend) w = Math.Max(w, 1 - Smoothstep(p.PadR, p.PadR + p.PadBlend, d));
		}
		return w;
	}

	double PadOffset(double x, double z, double nat)
	{
		int k0 = (int)JsRound(z / PoiSpacing);
		double off = 0;
		for (int k = k0 - 1; k <= k0 + 1; k++)
		{
			var p = PoiSlot(k);
			if (p == null) continue;
			double dx = x - p.X, dz = z - p.Z;
			double d = Math.Sqrt(dx * dx + dz * dz);
			if (d < p.PadR + p.PadBlend)
			{
				double t = 1 - Smoothstep(p.PadR, p.PadR + p.PadBlend, d);
				off += (p.Y - nat) * t;
				nat += (p.Y - nat) * t;
			}
		}
		return off;
	}

	public (double x, double y, double z) Normal(double x, double z, double e = 0.5)
	{
		double hx = Height(x + e, z) - Height(x - e, z);
		double hz = Height(x, z + e) - Height(x, z - e);
		double l = Math.Sqrt(hx * hx + 4 * e * e + hz * hz);
		return (-hx / l, 2 * e / l, -hz / l);
	}

	// Ground material weights into `o`: sand, dirt, rock, salt, grass, snow, forest floor, gravel.
	public void GroundMaterial(double x, double z, double nrmY, double[] bw, Span<double> o)
	{
		double slope = 1 - nrmY;
		double n = NC.Noise2(x * 0.02, z * 0.02) * 0.5 + 0.5;
		double n2 = NB.Noise2(x * 0.045 + 3, z * 0.045) * 0.5 + 0.5;
		double sc = bw[0], du = bw[1], ba = bw[2], sa = bw[3], hi = bw[4], pr = bw[5], fo = bw[6], ta = bw[7], tu = bw[8];
		double sand = du + sc * 0.25 + ba * 0.1;
		double dirt = sc * 0.75 + ba * 0.55 + hi * 0.45 + pr * 0.12 + fo * 0.15;
		double rock = hi * 0.55 + ba * 0.35 + ta * 0.05;
		double salt = sa;
		double grass = pr * 0.9 + fo * 0.3 + tu * 0.18 * n2 + hi * 0.05;
		double snow = ta * 0.9 + tu * (0.85 - 0.25 * n2);
		double forest = fo * 0.65 + ta * 0.12;
		// desert pavement: patches of packed gravel on the flats, sharp-edged and irregular
		double pv = NA.Noise2(x * 0.019 + 7, z * 0.019 - 3) + NB.Noise2(x * 0.07, z * 0.07) * 0.3;
		double dryland = sc + ba + hi + sa * 0.3;
		double gravel = Smoothstep(0.3, 0.55, pv) * dryland * 1.2;
		// and a sandy fringe where wind piles it in the low spots
		sand += Smoothstep(-0.1, -0.5, pv) * (sc + hi * 0.5) * 0.25;
		sand *= 0.7 + 0.6 * n;
		dirt *= 1.3 - 0.6 * n;
		grass *= 0.75 + 0.5 * n2;
		forest *= 0.7 + 0.6 * (1 - n2);
		// bare rock shows on steep ground, but sand dunes stay sand and green country turns to earth
		// first and only to rock on real cliffs
		double green = pr + fo + ta + tu;
		double steep = Smoothstep(0.05, 0.2, slope) * (1 - du * 0.92);
		// scree: loose gravel collects on the moderate slopes below the cliffs
		gravel += Smoothstep(0.03, 0.1, slope) * (1 - Smoothstep(0.18, 0.3, slope)) * (1 - green) * (1 - du) * 1.4;
		gravel *= 1 - Smoothstep(0.2, 0.35, slope);
		rock += steep * 3 * (1 - green * 0.75) + Smoothstep(0.3, 0.5, slope) * 2 * green;
		dirt += steep * 1.6 * green;
		salt *= 1 - Smoothstep(0.015, 0.06, slope);
		// mountains: bare rock high up, snow on the tops (lower in the north)
		double mh = Mountain(x, z, bw);
		if (mh > 40)
		{
			double desert = du + sc + ba + sa + hi;
			// desert ranges are bare rock; green ones are wooded to the tree line
			rock += Smoothstep(120, 300, mh) * desert * 2.5 + Smoothstep(330, 520, mh) * green * 2.2;
			forest += Smoothstep(60, 180, mh) * (fo + ta) * (1 - Smoothstep(330, 480, mh)) * 1.4;
			grass *= 1 - Smoothstep(260, 460, mh) * 0.85;
			forest *= 1 - Smoothstep(380, 520, mh);
			double line = 420 + desert * 160 - (ta + tu) * 200;
			snow += Smoothstep(line - 30, line + 70, mh + n * 40) * 4;
		}
		// snow slides off steep rock; grass thins on slopes
		snow *= 1 - Smoothstep(0.3, 0.6, slope) * 0.8;
		grass *= 1 - Smoothstep(0.12, 0.3, slope) * 0.8;
		// wet shores: sand and mud at rivers and lakes
		var rv = RiverAt(x, z);
		if (rv != null && rv.Value.D < rv.Value.R.W + 10)
		{
			var r = rv.Value;
			double t = Smoothstep(r.R.W + 10, r.R.W, r.D);
			sand += t * (r.R.Dry ? 2 : 1.2) * (1 - green * 0.85);
			dirt += t * (0.8 + green * 0.9);
			grass *= 1 - t * 0.6;
			snow *= 1 - t * (r.R.Frozen ? 0.2 : 0.8);
			gravel *= Smoothstep(r.R.W, r.R.W + 10, r.D);
		}
		double s = sand + dirt + rock + salt + grass + snow + forest + gravel + 1e-6;
		o[0] = sand / s;
		o[1] = dirt / s;
		o[2] = rock / s;
		o[3] = salt / s;
		o[4] = grass / s;
		o[5] = snow / s;
		o[6] = forest / s;
		o[7] = gravel / s;
	}

	// Surface type for tyres and footsteps.
	public Surface SurfaceAt(double x, double z)
	{
		double rx = RoadX(z);
		double dx = Math.Abs(x - rx);
		if (dx < RoadHalfWidth)
		{
			var ri = RoadInfo(z);
			if (ri.snow > 0.55) return Surface.SnowRoad;
			return ri.dirt ? Surface.Gravel : Surface.Asphalt;
		}
		if (dx < RoadHalfWidth + RoadShoulder) return RoadInfo(z).snow > 0.5 ? Surface.Snow : Surface.Gravel;
		var tn = TrackNear(x, z);
		if (tn != null && tn.Value.d < TrackHalfWidth + 0.4) return RoadInfo(z).snow > 0.5 ? Surface.SnowRoad : Surface.Dirt;
		var bw = BiomeWeights(x, z, new double[BiomeCount]);
		var nrm = Normal(x, z, 1.0);
		Span<double> m = stackalloc double[8];
		GroundMaterial(x, z, nrm.y, bw, m);
		int best = 0;
		for (int i = 1; i < 8; i++)
			if (m[i] > m[best]) best = i;
		return best switch
		{
			0 => Surface.Sand, 1 => Surface.Dirt, 2 => Surface.Rock, 3 => Surface.Salt, 4 => Surface.Grass, 5 => Surface.Snow, 6 => Surface.Dirt, _ => Surface.Gravel,
		};
	}
}
