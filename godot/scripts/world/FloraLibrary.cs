using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace DustRoad.World;

// The models of every scatter species (ScatterGen.Table order), each variant's full mesh and the
// coarser ones for further off, with their materials. Models come from assets/models/scatter/
// <species>.glb (objects <species>_<v>, <species>_<v>_lod1 and <species>_<v>_mid) and textures
// from assets/models/scatter/textures/<species>_<v>_{albedo,normal,orm}.jpg; a species without
// a file is not drawn. Loaded once, on the main thread.
public sealed class FloraLibrary
{
	public sealed class Variant
	{
		public Mesh Lod0, Lod1, Mid;
	}

	const string Dir = "res://assets/models/scatter/";

	// [species][variant]: null for a species without models
	public readonly Variant[][] Species = new Variant[ScatterGen.Table.Length][];

	static Shader _rock, _foliage;

	public FloraLibrary()
	{
		_rock ??= GD.Load<Shader>("res://shaders/rock.gdshader");
		_foliage ??= GD.Load<Shader>("res://shaders/foliage.gdshader");
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
			var mats = new Material[models];
			for (int k = 0; k < models; k++) mats[k] = MaterialFor(def, $"{def.Id}_{k}");
			var list = new Variant[def.Variants];
			for (int v = 0; v < def.Variants; v++)
			{
				int k = v % models;
				string n = $"{def.Id}_{k}";
				list[v] = new Variant
				{
					Lod0 = WithMaterial(meshes[n], mats[k]),
					Lod1 = meshes.TryGetValue(n + "_lod1", out var l1) ? WithMaterial(l1, mats[k]) : null,
					Mid = meshes.TryGetValue(n + "_mid", out var m) ? WithMaterial(m, mats[k]) : null,
				};
			}
			Species[si] = list;
			if (OS.GetCmdlineUserArgs().Contains("--scatterinfo"))
				foreach (var (n, m) in meshes)
					GD.Print($"scatter {n}: surfaces {m.GetSurfaceCount()} aabb {m.GetAabb().Size} mat {(m.SurfaceGetMaterial(0) as ShaderMaterial)?.GetShaderParameter("albedo_tex").As<Texture2D>()?.ResourcePath}");
		}
	}

	static void Collect(Node n, Dictionary<string, Mesh> into)
	{
		if (n is MeshInstance3D mi && mi.Mesh != null) into[n.Name] = mi.Mesh;
		foreach (var c in n.GetChildren()) Collect(c, into);
	}

	static Mesh WithMaterial(Mesh m, Material mat)
	{
		for (int s = 0; s < m.GetSurfaceCount(); s++) m.SurfaceSetMaterial(s, mat);
		return m;
	}

	static Texture2D Tex(string name, string kind)
	{
		string p = $"{Dir}textures/{name}_{kind}.jpg";
		return ResourceLoader.Exists(p) ? GD.Load<Texture2D>(p) : null;
	}

	static Material MaterialFor(ScatterGen.Species def, string name)
	{
		bool plant = def.Sway != null && def.Id != "shrub";
		var m = new ShaderMaterial { Shader = plant ? _foliage : _rock };
		m.SetShaderParameter("albedo_tex", Tex(name, "albedo"));
		m.SetShaderParameter("normal_tex", Tex(name, "normal"));
		m.SetShaderParameter("orm_tex", Tex(name, "orm"));
		if (plant) return m;
		// stumps and logs keep their wood; moss stays green; snowrock is always snowed on
		m.SetShaderParameter("tint_amount", def.Rock ? def.Id == "mossrock" ? 0.15f : 0.45f : 0f);
		if (def.Id == "snowrock") m.SetShaderParameter("snow_base", 0.85f);
		return m;
	}
}
