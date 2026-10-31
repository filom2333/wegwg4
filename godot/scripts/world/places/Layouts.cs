using System;
using System.Collections.Generic;
using Godot;

namespace DustRoad.World.Places;

// Which buildings make up each kind of place and where they stand in it (+z toward the road), by
// the names of the models from tools/blender/buildings.py: a port of web/src/world/poiLayouts.js,
// growing as the kinds are modelled. Runs on a worker thread.
public static class Layouts
{
	public sealed class Entry
	{
		public string Model;
		public float X, Y, Z, Rot;
		public string Tag;
		// how far gone it is (0 kept, 1 derelict): the weathering of its materials
		public float Age = 0.5f;
		// stands on the land where it is (not on the place's level pad)
		public bool Snap;
	}

	public sealed class Plan
	{
		public readonly List<Entry> Entries = new();
		// post-and-rail fences along these lines
		public readonly List<Vector2[]> Fences = new();
	}

	// the house models: style -> how many variants
	static readonly Dictionary<string, int> HouseVariants = new()
	{
		["siding"] = 2, ["sidingYellow"] = 1, ["sidingGreen"] = 1, ["brick"] = 1, ["stucco"] = 1, ["stuccoFlat"] = 1, ["adobe"] = 1,
	};

	// what people built with where (the desert's stucco and adobe, the plains' and woods' siding)
	static string[] Styles(Biome b) => b switch
	{
		Biome.Scrub or Biome.Badlands or Biome.Dunes or Biome.Saltflat => new[] { "stucco", "stuccoFlat", "adobe", "sidingYellow", "siding" },
		Biome.Prairie or Biome.Highland => new[] { "siding", "sidingYellow", "sidingGreen", "brick", "stucco" },
		_ => new[] { "siding", "sidingGreen", "brick", "sidingYellow" },
	};

	static string HouseModel(Func<double> rnd, Biome b, bool kept)
	{
		var styles = Styles(b);
		string style = styles[(int)(rnd() * styles.Length)];
		int v = (int)(rnd() * HouseVariants[style]);
		return $"house_{style}_{v}_{(kept ? "kept" : "old")}";
	}

	// The layout of a place, or null for kinds not modelled yet.
	public static Plan For(Poi poi, Func<double> rnd) => poi.Type switch
	{
		PoiType.Homestead => Homestead(),
		PoiType.House => SingleHouse(poi, rnd),
		PoiType.Houses => Houses(poi, rnd),
		_ => null,
	};

	// The player's own: a sided house kept up, the workshop beside it, the mailbox by the road.
	static Plan Homestead()
	{
		var p = new Plan();
		p.Entries.Add(new Entry { Model = "house_siding_0_kept", X = -6.5f, Z = -2, Age = 0.15f });
		p.Entries.Add(new Entry { Model = "workshop", X = 8.5f, Z = -1.5f, Tag = "garage", Age = 0.3f });
		p.Entries.Add(new Entry { Model = "mailbox", X = -3, Z = 12, Snap = true, Age = 0.3f });
		p.Fences.Add(new[] { new Vector2(-14, 9), new Vector2(-4, 9) });
		p.Fences.Add(new[] { new Vector2(-14, 9), new Vector2(-14, -9) });
		return p;
	}

	static Plan SingleHouse(Poi poi, Func<double> rnd)
	{
		var p = new Plan();
		bool kept = rnd() < 0.15;
		string model = HouseModel(rnd, poi.Biome, kept);
		var meta = BuildingLibrary.GetMeta(model);
		float age = kept ? 0.35f : 0.8f;
		p.Entries.Add(new Entry { Model = model, Age = age });
		if (rnd() < 0.5)
		{
			string g = new[] { "garage_iron", "garage_siding", "garage_shut" }[(int)(rnd() * 3)];
			p.Entries.Add(new Entry { Model = g, X = meta.Footprint.X / 2 + 4.5f, Z = -1, Tag = "garage", Age = age });
		}
		p.Entries.Add(new Entry { Model = "mailbox", X = 2, Z = meta.Footprint.Y / 2 + 5, Snap = true, Age = age });
		return p;
	}

	// Two or three houses in a row.
	static Plan Houses(Poi poi, Func<double> rnd)
	{
		var p = new Plan();
		int n = 2 + (rnd() < 0.5 ? 1 : 0);
		float x = -((n - 1) * 19) / 2f;
		for (int i = 0; i < n; i++)
		{
			bool kept = rnd() < 0.15;
			p.Entries.Add(new Entry { Model = HouseModel(rnd, poi.Biome, kept), X = x + (float)(rnd() - 0.5) * 2, Z = (float)(rnd() - 0.5) * 4, Rot = (float)(rnd() - 0.5) * 0.1f, Age = kept ? 0.35f : 0.8f });
			x += 19;
		}
		return p;
	}
}
