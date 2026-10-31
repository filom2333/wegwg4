using System.Collections.Generic;
using System.Text.Json;
using Godot;

namespace DustRoad.World.Places;

// The materials of the buildings' tokens (the material names in the models from
// tools/blender/buildings.py), from assets/textures/building/palette.json, the palette the
// Blender previews use too: CC0 scans on shaders/building.gdshader (painted, tinted, weathered)
// for walls, roofs, floors and trim, plain materials for metal and plastic, glass. Main thread.
public static class BuildingMaterials
{
	const string PalettePath = "res://assets/textures/building/palette.json";

	static JsonElement _scans, _plain, _glass;
	static bool _loaded;
	static readonly Dictionary<string, Material> Cache = new();

	static void Load()
	{
		if (_loaded) return;
		_loaded = true;
		var doc = JsonDocument.Parse(FileAccess.GetFileAsString(PalettePath));
		_scans = doc.RootElement.GetProperty("scans");
		_plain = doc.RootElement.GetProperty("plain");
		_glass = doc.RootElement.GetProperty("glass");
	}

	public static Material Get(string token)
	{
		if (Cache.TryGetValue(token, out var m)) return m;
		Load();
		Cache[token] = m = Make(token);
		return m;
	}

	// Glass and the like: drawn without casting shadows.
	public static bool IsClear(string token) => token is "glass" or "glassDirty";

	static float F(JsonElement e, string key, float dflt) => e.TryGetProperty(key, out var v) ? v.GetSingle() : dflt;

	static Vector3 V3(JsonElement e, string key, Vector3 dflt)
	{
		if (!e.TryGetProperty(key, out var v)) return dflt;
		return new Vector3(v[0].GetSingle(), v[1].GetSingle(), v[2].GetSingle());
	}

	static Color Col(JsonElement a) => new(a[0].GetSingle(), a[1].GetSingle(), a[2].GetSingle());

	static Material Make(string token)
	{
		if (_scans.TryGetProperty(token, out var s))
		{
			var mat = new ShaderMaterial { Shader = GD.Load<Shader>("res://shaders/building.gdshader") };
			string dir = "res://assets/textures/" + s.GetProperty("file").GetString();
			mat.SetShaderParameter("albedo_tex", GD.Load<Texture2D>(dir + "_diff.jpg"));
			mat.SetShaderParameter("arm_tex", GD.Load<Texture2D>(dir + "_arm.jpg"));
			mat.SetShaderParameter("normal_tex", GD.Load<Texture2D>(dir + "_nor.jpg"));
			var metres = s.GetProperty("metres");
			mat.SetShaderParameter("tex_metres", new Vector2(metres[0].GetSingle(), metres[1].GetSingle()));
			mat.SetShaderParameter("tint", V3(s, "tint", Vector3.One));
			var paint = s.TryGetProperty("paint", out var p) ? new Color(p[0].GetSingle(), p[1].GetSingle(), p[2].GetSingle(), p[3].GetSingle()) : new Color(1, 1, 1, 0);
			mat.SetShaderParameter("paint", paint);
			mat.SetShaderParameter("normal_strength", F(s, "normal", 1));
			mat.SetShaderParameter("rough_scale", F(s, "rough", 1));
			mat.SetShaderParameter("metal", F(s, "metal", -1));
			mat.SetShaderParameter("outdoor", !s.TryGetProperty("outdoor", out var od) || od.GetBoolean());
			mat.SetShaderParameter("dirt", F(s, "dirt", 0.5f));
			mat.SetShaderParameter("dust", F(s, "dust", 0.35f));
			mat.SetShaderParameter("rust", F(s, "rust", 0));
			mat.SetShaderParameter("peel", F(s, "peel", 0));
			return mat;
		}
		if (_glass.TryGetProperty(token, out var g))
			return new StandardMaterial3D
			{
				AlbedoColor = new Color(Col(g[0]), g[1].GetSingle()),
				Roughness = g[2].GetSingle(),
				MetallicSpecular = 0.7f,
				Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
				CullMode = BaseMaterial3D.CullModeEnum.Disabled,
			};
		if (_plain.TryGetProperty(token, out var pl))
			return new StandardMaterial3D { AlbedoColor = Col(pl[0]), Roughness = pl[1].GetSingle(), Metallic = pl[2].GetSingle() };
		GD.PushWarning($"building material '{token}' not in the palette: magenta");
		return new StandardMaterial3D { AlbedoColor = new Color(1, 0, 1) };
	}
}
