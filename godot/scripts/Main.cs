using Godot;

namespace DustRoad;

// First test scene of the port: a stretch of desert with a dirt road, sun, sky and haze, seen from
// eye height. Run with `-- --shot=path.png` to save a picture after a few frames and quit.
public partial class Main : Node3D
{
	const int Size = 256; // terrain cells per side
	const float Cell = 2f; // metres per cell

	string _shot;
	int _frames;

	public override void _Ready()
	{
		foreach (var a in OS.GetCmdlineUserArgs())
			if (a.StartsWith("--shot=")) _shot = a.Substring(7);

		var noise = new FastNoiseLite { NoiseType = FastNoiseLite.NoiseTypeEnum.SimplexSmooth, Frequency = 0.004f, FractalOctaves = 5 };
		AddChild(Terrain(noise));
		AddChild(Sun());
		AddChild(Sky());
		var cam = new Camera3D { Fov = 70, Near = 0.05f, Far = 2000 };
		AddChild(cam);
		var eye = new Vector3(0, Height(noise, 0, 0) + 1.64f, 0);
		cam.LookAtFromPosition(eye, eye + new Vector3(0.15f, -0.08f, -1));
	}

	public override void _Process(double delta)
	{
		if (_shot == null || ++_frames < 8) return;
		GetViewport().GetTexture().GetImage().SavePng(_shot);
		GetTree().Quit();
	}

	// rolling desert, flattened along the road (x = 0)
	static float Height(FastNoiseLite n, float x, float z)
	{
		float h = n.GetNoise2D(x, z) * 18f;
		float road = Mathf.SmoothStep(4f, 14f, Mathf.Abs(x));
		return Mathf.Lerp(n.GetNoise2D(0, z) * 18f, h, road);
	}

	static MeshInstance3D Terrain(FastNoiseLite n)
	{
		var st = new SurfaceTool();
		st.Begin(Mesh.PrimitiveType.Triangles);
		float o = -Size * Cell / 2;
		var sand = new Color(0.78f, 0.62f, 0.44f);
		var dirt = new Color(0.62f, 0.5f, 0.38f);
		for (int j = 0; j <= Size; j++)
			for (int i = 0; i <= Size; i++)
			{
				float x = o + i * Cell, z = o + j * Cell;
				float k = Mathf.SmoothStep(2.5f, 4.5f, Mathf.Abs(x));
				st.SetColor(dirt.Lerp(sand, k));
				st.SetUV(new Vector2(x, z) * 0.25f);
				st.AddVertex(new Vector3(x, Height(n, x, z), z));
			}
		for (int j = 0; j < Size; j++)
			for (int i = 0; i < Size; i++)
			{
				int a = j * (Size + 1) + i, b = a + Size + 1;
				st.AddIndex(a); st.AddIndex(a + 1); st.AddIndex(b);
				st.AddIndex(a + 1); st.AddIndex(b + 1); st.AddIndex(b);
			}
		st.GenerateNormals();
		var mat = new StandardMaterial3D { VertexColorUseAsAlbedo = true, VertexColorIsSrgb = true, Roughness = 0.95f };
		return new MeshInstance3D { Mesh = st.Commit(), MaterialOverride = mat };
	}

	static DirectionalLight3D Sun()
	{
		var sun = new DirectionalLight3D { LightEnergy = 1.3f, ShadowEnabled = true, LightColor = new Color(1f, 0.95f, 0.86f) };
		sun.RotationDegrees = new Vector3(-38, 140, 0);
		return sun;
	}

	static WorldEnvironment Sky()
	{
		var sky = new Sky { SkyMaterial = new ProceduralSkyMaterial { SkyTopColor = new Color(0.32f, 0.5f, 0.78f), SkyHorizonColor = new Color(0.78f, 0.8f, 0.82f), GroundHorizonColor = new Color(0.7f, 0.62f, 0.52f) } };
		var env = new Environment
		{
			BackgroundMode = Environment.BGMode.Sky,
			Sky = sky,
			AmbientLightSource = Environment.AmbientSource.Sky,
			TonemapMode = Environment.ToneMapper.Agx,
			FogEnabled = true,
			FogDensity = 0.00035f,
			FogSkyAffect = 0.25f,
			FogLightColor = new Color(0.82f, 0.8f, 0.76f),
		};
		return new WorldEnvironment { Environment = env };
	}
}
