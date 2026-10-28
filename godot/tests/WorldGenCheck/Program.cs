// Compares the C# WorldGen with reference values from the browser version (ref.mjs). Exit code 1
// when anything differs by more than the tolerance; prints the worst differences either way.
using System.Text.Json;
using DustRoad.World;

var doc = JsonDocument.Parse(File.ReadAllText(args.Length > 0 ? args[0] : "ref.json"));
string[] biomeIds = { "scrub", "dunes", "badlands", "saltflat", "highland", "prairie", "forest", "taiga", "tundra" };
string[] surfIds = { "asphalt", "gravel", "dirt", "sand", "rock", "salt", "grass", "snow", "snowRoad" };
bool ok = true;

void Report(string what, double worst, double tol, string where)
{
	bool good = worst <= tol;
	ok &= good;
	Console.WriteLine($"{(good ? "ok  " : "FAIL")} {what,-14} worst {worst:G4} (tolerance {tol:G2}){(good ? "" : "  at " + where)}");
}

static string PoiId(PoiType t) => char.ToLowerInvariant(t.ToString()[0]) + t.ToString()[1..];

foreach (var seedProp in doc.RootElement.EnumerateObject())
{
	int seed = int.Parse(seedProp.Name);
	var g = new WorldGen(seed);
	var d = seedProp.Value;
	Console.WriteLine($"seed {seed}");

	// biome cells and the places along the road come first: everything else stands on them
	int cellBad = 0;
	int ci = 0;
	foreach (var c in d.GetProperty("cells").EnumerateArray())
		if (biomeIds[(int)g.CellBiome(ci++)] != c.GetString()) cellBad++;
	Report("biome cells", cellBad, 0, $"{cellBad} cells");

	double worstPoi = 0;
	int poiBad = 0;
	string poiWhere = "";
	foreach (var p in d.GetProperty("pois").EnumerateArray())
	{
		if (p.ValueKind == JsonValueKind.Null) continue;
		int k = p.GetProperty("k").GetInt32();
		var mine = g.PoiSlot(k);
		if (mine == null || PoiId(mine.Type) != p.GetProperty("type").GetString() || mine.Seed != p.GetProperty("seed").GetInt32())
		{
			poiBad++;
			poiWhere = $"slot {k}: {(mine == null ? "none" : PoiId(mine.Type))} vs {p.GetProperty("type").GetString()}";
			continue;
		}
		double e = Math.Max(Math.Abs(mine.X - p.GetProperty("x").GetDouble()), Math.Abs(mine.Z - p.GetProperty("z").GetDouble()));
		if (e > worstPoi) { worstPoi = e; poiWhere = $"slot {k}"; }
	}
	Report("places", poiBad, 0, poiWhere);
	Report("place xz", worstPoi, 0.05, poiWhere);

	int waterBad = 0;
	int rk = 0;
	foreach (var r in d.GetProperty("rivers").EnumerateArray())
	{
		var mine = g.RiverOf(rk++);
		if ((mine == null) != (r.ValueKind == JsonValueKind.Null)) waterBad++;
		else if (mine != null && (Math.Abs(mine.Zr - r.GetProperty("zr").GetDouble()) > 0.01 || mine.Dry != r.GetProperty("dry").GetBoolean() || Math.Abs(mine.Level - r.GetProperty("level").GetDouble()) > 0.02)) waterBad++;
	}
	int lk = 0;
	foreach (var l in d.GetProperty("lakes").EnumerateArray())
	{
		var mine = g.LakeOf(lk++);
		if ((mine == null) != (l.ValueKind == JsonValueKind.Null)) waterBad++;
		else if (mine != null && Math.Abs(mine.X - l.GetProperty("x").GetDouble()) > 0.01) waterBad++;
	}
	int tk = 0;
	foreach (var t in d.GetProperty("tracks").EnumerateArray())
	{
		var mine = g.TrackOf(tk++);
		if ((mine == null) != (t.ValueKind == JsonValueKind.Null)) waterBad++;
		else if (mine != null && (Math.Abs(mine.Z0 - t.GetProperty("z0").GetDouble()) > 0.01 || mine.BlockKind != (t.GetProperty("block").ValueKind == JsonValueKind.Null ? null : t.GetProperty("block").GetString()))) waterBad++;
	}
	Report("rivers/lakes/tracks", waterBad, 0, $"{waterBad} differ");

	double wRx = 0, wRy = 0, wH = 0, wNat = 0, wMtn = 0, wBw = 0, wMat = 0;
	string at = "";
	int surfBad = 0;
	var bw = new double[WorldGen.BiomeCount];
	var mat = new double[8];
	foreach (var p in d.GetProperty("pts").EnumerateArray())
	{
		double x = p.GetProperty("x").GetDouble(), z = p.GetProperty("z").GetDouble();
		void W(ref double worst, double v, double reference)
		{
			double e = Math.Abs(v - reference);
			if (e > worst) { worst = e; at = $"({x:F1}, {z:F1})"; }
		}
		W(ref wRx, g.RoadX(z), p.GetProperty("roadX").GetDouble());
		W(ref wRy, g.RoadY(Math.Floor(z * 2 + 0.5) / 2), p.GetProperty("roadY").GetDouble());
		W(ref wH, g.Height(x, z), p.GetProperty("h").GetDouble());
		W(ref wNat, g.NaturalHeight(x, z), p.GetProperty("nat").GetDouble());
		W(ref wMtn, g.Mountain(x, z), p.GetProperty("mtn").GetDouble());
		g.BiomeWeights(x, z, bw);
		int i = 0;
		foreach (var v in p.GetProperty("bw").EnumerateArray()) W(ref wBw, bw[i++], v.GetDouble());
		var n = g.Normal(x, z);
		g.GroundMaterial(x, z, n.y, bw, mat);
		i = 0;
		foreach (var v in p.GetProperty("mat").EnumerateArray()) W(ref wMat, mat[i++], v.GetDouble());
		if (surfIds[(int)g.SurfaceAt(x, z)] != p.GetProperty("surf").GetString()) surfBad++;
	}
	Report("road x", wRx, 1e-6, at);
	Report("road y", wRy, 1e-6, at);
	// (the browser's heights carry its road-height cache's few cm; this port has none)
	Report("height", wH, 0.05, at);
	Report("natural", wNat, 0.02, at);
	Report("mountain", wMtn, 1e-6, at);
	Report("biome weight", wBw, 1e-9, at);
	Report("ground mat", wMat, 0.02, at);
	Report("surface", surfBad, 2, $"{surfBad} points");

	// scatter: the same instances in each cell (heights to the road cache's few cm; a plant on a
	// slope right at its species' limit may come out either way)
	int cellsBad = 0, inst = 0;
	double wInst = 0, wY = 0;
	string sWhere = "";
	foreach (var c in d.GetProperty("scatter").EnumerateArray())
	{
		int cx = c.GetProperty("ci").GetInt32(), cz = c.GetProperty("cj").GetInt32();
		var refd = c.GetProperty("data").EnumerateArray().Select(v => v.GetDouble()).ToArray();
		var mine = ScatterGen.CellInstances(new WorldGen(seed), cx, cz);
		inst += refd.Length / ScatterGen.Stride;
		if (mine.Length != refd.Length)
		{
			cellsBad++;
			sWhere = $"cell {cx},{cz}: {mine.Length / 8} vs {refd.Length / 8}";
			continue;
		}
		// (a cell that parts ways on a borderline plant differs from there on: count it, don't
		// compare its values)
		bool diverged = false;
		for (int k = 0; k < refd.Length; k++)
			if (k % 8 != 3 && Math.Abs(mine[k] - refd[k]) > 0.01) diverged = true;
		if (diverged)
		{
			cellsBad++;
			sWhere = $"cell {cx},{cz} parts ways";
			continue;
		}
		for (int k = 0; k < refd.Length; k++)
		{
			double e = Math.Abs(mine[k] - refd[k]);
			if (k % 8 == 3) { if (e > wY) wY = e; }
			else if (e > wInst) { wInst = e; sWhere = $"cell {cx},{cz} value {k}"; }
		}
	}
	Console.WriteLine($"     scatter: {d.GetProperty("scatter").GetArrayLength()} cells, {inst} instances");
	Report("scatter cells", cellsBad, 2, sWhere);
	Report("scatter values", wInst, 1e-3, sWhere);
	Report("scatter y", wY, 0.1, sWhere);
}
return ok ? 0 : 1;
