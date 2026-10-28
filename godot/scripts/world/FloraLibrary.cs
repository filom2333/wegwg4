using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace DustRoad.World;

// The models of every scatter species (ScatterGen.Table order), each variant's full mesh and the
// coarser ones for further off, with their materials. Models come from assets/models/scatter/
// <species>.glb (objects <species>_<v>, <species>_<v>_lod1 and <species>_<v>_mid); a species
// without a file is not drawn. Loaded once, on the main thread.
//
// Two kinds of model: scans (tools/blender/scans.py: rocks, stumps, logs, ferns) with their own
// baked textures in assets/models/scatter/textures/<species>_<v>_{albedo,normal,orm}.jpg, and
// grown plants (tools/blender/plants.py) whose surfaces are named after their material (bark_pine,
// leaf_spruce, grass...), which are made here from assets/textures/plants/.
public sealed class FloraLibrary
{
	public sealed class Variant
	{
		public Mesh Lod0, Lod1, Mid;
	}

	const string Dir = "res://assets/models/scatter/";
	const string PlantTex = "res://assets/textures/plants/";

	// [species][variant]: null for a species without models
	public readonly Variant[][] Species = new Variant[ScatterGen.Table.Length][];

	// how each grown species sways: height the trunk bends over, top's swing (m), branches' own
	static readonly Dictionary<string, (float bend, float sway, float branch)> Wind = new()
	{
		["grass"] = (0.5f, 0.06f, 0.02f),
		["meadow"] = (0.8f, 0.1f, 0.03f),
		["snowgrass"] = (0.5f, 0.06f, 0.02f),
		["reeds"] = (1.6f, 0.12f, 0.04f),
		["flowers"] = (0.4f, 0.05f, 0.02f),
		["fern"] = (1.0f, 0.06f, 0.0f),
		["shrub"] = (1.0f, 0.03f, 0.03f),
		["tundrashrub"] = (0.7f, 0.03f, 0.03f),
		["yucca"] = (1.0f, 0.02f, 0.01f),
		["barrel"] = (1.0f, 0f, 0f),
		["saguaro"] = (8f, 0f, 0f),
		["ocotillo"] = (4f, 0.12f, 0.05f),
		["joshua"] = (5f, 0.02f, 0.01f),
		["deadtree"] = (6f, 0.05f, 0.03f),
		["pine"] = (18f, 0.25f, 0.08f),
		["snowpine"] = (16f, 0.2f, 0.06f),
		["birch"] = (13f, 0.3f, 0.12f),
		["birchbare"] = (13f, 0.25f, 0.08f),
	};

	// grass: foot, tip and the odd blade's colour
	static readonly Dictionary<string, (Color foot, Color tip, Color odd, float share)> GrassColors = new()
	{
		["grass"] = (new Color(0.33f, 0.27f, 0.16f), new Color(0.74f, 0.64f, 0.42f), new Color(0.5f, 0.5f, 0.3f), 0.15f),
		["meadow"] = (new Color(0.18f, 0.27f, 0.08f), new Color(0.5f, 0.56f, 0.24f), new Color(0.7f, 0.64f, 0.38f), 0.25f),
		["snowgrass"] = (new Color(0.34f, 0.29f, 0.19f), new Color(0.7f, 0.62f, 0.45f), new Color(0.55f, 0.5f, 0.38f), 0.2f),
		["reeds"] = (new Color(0.24f, 0.31f, 0.12f), new Color(0.6f, 0.6f, 0.34f), new Color(0.7f, 0.62f, 0.4f), 0.3f),
	};

	static Shader _rock, _solid, _leaf, _grass;
	readonly Dictionary<string, Material> _plantMats = new();

	public FloraLibrary()
	{
		_rock ??= GD.Load<Shader>("res://shaders/rock.gdshader");
		_solid ??= GD.Load<Shader>("res://shaders/plant_solid.gdshader");
		_leaf ??= GD.Load<Shader>("res://shaders/plant_leaf.gdshader");
		_grass ??= GD.Load<Shader>("res://shaders/grass.gdshader");
		bool info = OS.GetCmdlineUserArgs().Contains("--scatterinfo");
		for (int si = 0; si < ScatterGen.Table.Length; si++)
		{
			var def = ScatterGen.Table[si];
			string path = Dir + def.Id + ".glb";
			if (!ResourceLoader.Exists(path)) continue;
			var root = GD.Load<PackedScene>(path).Instantiate<Node>();
			var meshes = new Dictionary<string, Mesh>();
			Collect(root, meshes);
			root.Free();
			// the file may hold fewer models than the species has variants: they repeat
			int models = 0;
			while (meshes.ContainsKey($"{def.Id}_{models}")) models++;
			if (models == 0) continue;
			bool scanned = ResourceLoader.Exists($"{Dir}textures/{def.Id}_0_albedo.jpg");
			var list = new Variant[def.Variants];
			for (int v = 0; v < def.Variants; v++)
			{
				int k = v % models;
				string n = $"{def.Id}_{k}";
				Mesh Dress(Mesh m)
				{
					if (m == null) return null;
					if (scanned) SetAll(m, ScanMaterial(def, n));
					else for (int s = 0; s < m.GetSurfaceCount(); s++) m.SurfaceSetMaterial(s, PlantMaterial(def, m.SurfaceGetMaterial(s)?.ResourceName ?? "plant"));
					return m;
				}
				list[v] = new Variant
				{
					Lod0 = Dress(meshes[n]),
					Lod1 = Dress(meshes.GetValueOrDefault(n + "_lod1")),
					Mid = Dress(meshes.GetValueOrDefault(n + "_mid")),
				};
			}
			Species[si] = list;
			if (info)
				foreach (var (n, m) in meshes)
					GD.Print($"scatter {n}: surfaces {m.GetSurfaceCount()} aabb {m.GetAabb().Size} mats {string.Join(",", Enumerable.Range(0, m.GetSurfaceCount()).Select(s => m.SurfaceGetMaterial(s)?.ResourceName))}");
		}
	}

	static void Collect(Node n, Dictionary<string, Mesh> into)
	{
		if (n is MeshInstance3D mi && mi.Mesh != null) into[n.Name] = mi.Mesh;
		foreach (var c in n.GetChildren()) Collect(c, into);
	}

	static void SetAll(Mesh m, Material mat)
	{
		for (int s = 0; s < m.GetSurfaceCount(); s++) m.SurfaceSetMaterial(s, mat);
	}

	static Texture2D Tex(string path) => ResourceLoader.Exists(path) ? GD.Load<Texture2D>(path) : null;

	// A scan's baked textures: rocks, stumps and logs on the rock shader, ferns on the leaf one.
	static Material ScanMaterial(ScatterGen.Species def, string name)
	{
		string t = $"{Dir}textures/{name}_";
		if (def.Id == "fern")
		{
			var f = new ShaderMaterial { Shader = _leaf };
			f.SetShaderParameter("albedo_tex", Tex(t + "albedo.jpg"));
			f.SetShaderParameter("normal_tex", Tex(t + "normal.jpg"));
			f.SetShaderParameter("alpha_cut", 0.0f);
			SetWind(f, def.Id);
			return f;
		}
		var m = new ShaderMaterial { Shader = _rock };
		m.SetShaderParameter("albedo_tex", Tex(t + "albedo.jpg"));
		m.SetShaderParameter("normal_tex", Tex(t + "normal.jpg"));
		m.SetShaderParameter("orm_tex", Tex(t + "orm.jpg"));
		// stumps and logs keep their wood; moss stays green; snowrock is always snowed on
		m.SetShaderParameter("tint_amount", def.Rock ? def.Id == "mossrock" ? 0.15f : 0.45f : 0f);
		if (def.Id == "snowrock") m.SetShaderParameter("snow_base", 0.85f);
		return m;
	}

	static void SetWind(ShaderMaterial m, string species)
	{
		var (bend, sway, branch) = Wind.GetValueOrDefault(species, (1f, 0.03f, 0.02f));
		m.SetShaderParameter("bend_height", bend);
		m.SetShaderParameter("sway", sway);
		m.SetShaderParameter("branch_sway", branch);
	}

	// A grown plant's surface material, by the name plants.py gave it (one per species: the
	// species decides how it sways).
	Material PlantMaterial(ScatterGen.Species def, string name)
	{
		string key = def.Id + "/" + name;
		if (_plantMats.TryGetValue(key, out var have)) return have;
		ShaderMaterial m;
		if (GrassColors.TryGetValue(name, out var g))
		{
			m = new ShaderMaterial { Shader = _grass };
			m.SetShaderParameter("base_color", g.foot);
			m.SetShaderParameter("tip_color", g.tip);
			m.SetShaderParameter("odd_color", g.odd);
			m.SetShaderParameter("odd_share", g.share);
		}
		else if (name.StartsWith("leaf_"))
		{
			string twig = name[5..];
			m = new ShaderMaterial { Shader = _leaf };
			m.SetShaderParameter("albedo_tex", Tex($"{PlantTex}twig_{twig}_albedo.png"));
			m.SetShaderParameter("normal_tex", Tex($"{PlantTex}twig_{twig}_normal.png"));
			m.SetShaderParameter("translucency", twig is "spruce" or "pine" ? 0.25f : 0.5f);
			m.SetShaderParameter("flutter", twig is "birch" or "birch_autumn" or "dwarfbirch" ? 0.03f : 0.01f);
		}
		else if (name.StartsWith("bark_") || name.StartsWith("cactus_"))
		{
			m = new ShaderMaterial { Shader = _solid };
			// scanned barks (pine, a grey willow for the rest, tinted) or a skin painted by plants.py
			string scan = name is "bark_pine" or "bark_spruce" ? "bark_pine" : name is "bark_grey" or "bark_dead" or "bark_joshua" or "bark_ocotillo" ? "bark_grey" : null;
			if (scan != null)
			{
				m.SetShaderParameter("albedo_tex", Tex($"{PlantTex}{scan}_diff.jpg"));
				m.SetShaderParameter("normal_tex", Tex($"{PlantTex}{scan}_nor.jpg"));
				m.SetShaderParameter("orm_tex", Tex($"{PlantTex}{scan}_arm.jpg"));
			}
			else
			{
				m.SetShaderParameter("albedo_tex", Tex($"{PlantTex}{name}_albedo.jpg"));
				m.SetShaderParameter("use_normal", false);
				m.SetShaderParameter("roughness", name.StartsWith("cactus_") ? 0.6f : 0.75f);
			}
			m.SetShaderParameter("tint", name switch
			{
				"bark_joshua" => new Color(0.62f, 0.56f, 0.5f),
				"bark_ocotillo" => new Color(0.82f, 0.8f, 0.72f),
				"bark_dead" => new Color(1.05f, 1.02f, 0.98f),
				// (spruce bark: the pine scan, greyed)
				"bark_spruce" => new Color(0.62f, 0.6f, 0.6f),
				_ => new Color(1, 1, 1),
			});
		}
		else
		{
			// plain leaves coloured by their vertices
			m = new ShaderMaterial { Shader = _leaf };
			m.SetShaderParameter("use_tex", false);
			m.SetShaderParameter("translucency", 0.3f);
		}
		SetWind(m, def.Id);
		_plantMats[key] = m;
		return m;
	}
}
