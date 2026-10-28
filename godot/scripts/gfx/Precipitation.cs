using System;
using Godot;

namespace DustRoad.Gfx;

// Rain and snow round the camera, as heavy as DayCycle's weather says (snow in the north and on
// snow days, rain elsewhere). The drops live entirely in their shaders (shaders/rain.gdshader,
// snow.gdshader): this only builds the meshes once and hands over the amount, wind and light.
public partial class Precipitation : Node3D
{
	[Export] public NodePath DayCyclePath = "../DayCycle";
	[Export] public int RainDrops = 9000;
	[Export] public int SnowFlakes = 7000;

	MeshInstance3D _rain, _snow;
	ShaderMaterial _rainMat, _snowMat;
	float _rainNow, _snowNow;

	public override void _Ready()
	{
		_rainMat = new ShaderMaterial { Shader = GD.Load<Shader>("res://shaders/rain.gdshader") };
		_snowMat = new ShaderMaterial { Shader = GD.Load<Shader>("res://shaders/snow.gdshader") };
		_snowMat.SetShaderParameter("fall", 1.1f);
		_snowMat.SetShaderParameter("box", new Vector3(26, 16, 26));
		_rain = Make("Rain", RainDrops, _rainMat, 11);
		_snow = Make("Snow", SnowFlakes, _snowMat, 23);
	}

	MeshInstance3D Make(string name, int n, Material mat, int seed)
	{
		var rnd = new Random(seed);
		var pos = new Vector3[n * 4];
		var uv = new Vector2[n * 4];
		var uv2 = new Vector2[n * 4];
		var col = new Color[n * 4];
		var idx = new int[n * 6];
		for (int i = 0; i < n; i++)
		{
			var c = new Color((float)rnd.NextDouble(), (float)rnd.NextDouble(), (float)rnd.NextDouble());
			// (the order they show in as it gets heavier: mixed up, so light rain is spread even)
			float order = (float)rnd.NextDouble();
			for (int k = 0; k < 4; k++)
			{
				uv[i * 4 + k] = new Vector2(k is 1 or 2 ? 1 : 0, k >= 2 ? 1 : 0);
				uv2[i * 4 + k] = new Vector2(order, 0);
				col[i * 4 + k] = c;
			}
			int b = i * 4;
			idx[i * 6] = b;
			idx[i * 6 + 1] = b + 2;
			idx[i * 6 + 2] = b + 1;
			idx[i * 6 + 3] = b;
			idx[i * 6 + 4] = b + 3;
			idx[i * 6 + 5] = b + 2;
		}
		var arrays = new Godot.Collections.Array();
		arrays.Resize((int)Mesh.ArrayType.Max);
		arrays[(int)Mesh.ArrayType.Vertex] = pos;
		arrays[(int)Mesh.ArrayType.TexUV] = uv;
		arrays[(int)Mesh.ArrayType.TexUV2] = uv2;
		arrays[(int)Mesh.ArrayType.Color] = col;
		arrays[(int)Mesh.ArrayType.Index] = idx;
		var mesh = new ArrayMesh();
		mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays);
		// (the drops are placed in the shader round the camera, wherever it is)
		mesh.CustomAabb = new Aabb(new Vector3(-1e5f, -1e4f, -1e5f), new Vector3(2e5f, 2e4f, 2e5f));
		mesh.SurfaceSetMaterial(0, mat);
		var mi = new MeshInstance3D { Name = name, Mesh = mesh, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off, Visible = false };
		AddChild(mi);
		return mi;
	}

	public override void _Process(double delta)
	{
		var day = GetNodeOrNull<DayCycle>(DayCyclePath);
		if (day == null) return;
		float rain = day.Snowing ? 0 : day.W.Rain;
		float snow = day.Snowing ? day.W.Rain : 0;
		float k = Math.Min(1, (float)delta * 0.5f);
		_rainNow += (rain - _rainNow) * k;
		_snowNow += (snow - _snowNow) * k;
		if (day.Instant)
		{
			_rainNow = rain;
			_snowNow = snow;
		}
		var wind = new Vector3(0.86f, 0, 0.5f) * (day.W.Wind * 6);
		float light = 0.12f + 0.88f * day.Daylight;
		_rain.Visible = _rainNow > 0.01f;
		_snow.Visible = _snowNow > 0.01f;
		_rainMat.SetShaderParameter("amount", Math.Min(1, _rainNow * 1.2f));
		_rainMat.SetShaderParameter("drift", wind);
		_rainMat.SetShaderParameter("light_level", light);
		_snowMat.SetShaderParameter("amount", Math.Min(1, _snowNow * 1.2f));
		_snowMat.SetShaderParameter("drift", wind * 0.5f);
		_snowMat.SetShaderParameter("light_level", light);
	}
}
