using System;
using System.Collections.Generic;
using Godot;
using DustRoad.World;

namespace DustRoad.Gfx;

// Lightning in a storm, when DayCycle says: mostly far over the land, now and then close. A
// forked channel from high up down to the ground with a glow round it, two or three return
// strokes, and where a close one lands, a white-blue flash over the land round it, sparks and a
// puff of smoke. A port of lightning() in web/src/gfx/effects.js (the thunder comes with the
// sound, the ground current with the player).
public partial class Lightning : Node3D
{
	[Export] public NodePath DayCyclePath = "../DayCycle";
	// the browser's strike light of 1500, on this project's light scale (DayCycle.SunScale)
	[Export] public float LightEnergy = 372;

	public WorldGen Gen;
	// pictures: the bolt stays at its brightest
	public bool Hold;

	Node3D _at;
	MeshInstance3D _bolt;
	ShaderMaterial _core, _halo;
	OmniLight3D _light;
	GpuParticles3D _sparks, _smoke;
	float _t, _len;
	bool _near;
	readonly Random _flicker = new(5);

	public override void _Ready()
	{
		_core = new ShaderMaterial { Shader = GD.Load<Shader>("res://shaders/bolt.gdshader") };
		_halo = new ShaderMaterial { Shader = _core.Shader };
		_halo.SetShaderParameter("color", new Vector3(0.5f, 0.6f, 1.2f));
		_halo.SetShaderParameter("halo", 1.0f);
		_at = new Node3D { Name = "Strike" };
		AddChild(_at);
		_bolt = new MeshInstance3D { Name = "Bolt", CastShadow = GeometryInstance3D.ShadowCastingSetting.Off, Visible = false };
		_at.AddChild(_bolt);
		_light = new OmniLight3D
		{
			Name = "Light",
			OmniRange = 600,
			OmniAttenuation = 1.1f,
			LightColor = new Color(0.875f, 0.9f, 1f),
			LightEnergy = 0,
			// (a long channel, not a point: as a point its glint off wet ground would be one blinding
			// spot)
			LightSpecular = 0.05f,
			Visible = false,
			Position = new Vector3(0, 40, 0),
		};
		_at.AddChild(_light);
		_sparks = MakeSparks();
		_smoke = MakeSmoke();
		_at.AddChild(_sparks);
		_at.AddChild(_smoke);
		var day = GetNodeOrNull<DayCycle>(DayCyclePath);
		if (day != null) day.Strike += OnStrike;
		WorldOrigin.Shifted += OnShifted;
	}

	public override void _ExitTree()
	{
		var day = GetNodeOrNull<DayCycle>(DayCyclePath);
		if (day != null) day.Strike -= OnStrike;
		WorldOrigin.Shifted -= OnShifted;
	}

	void OnShifted(double dx, double dz) => _at.Position -= new Vector3((float)dx, 0, (float)dz);

	void OnStrike(double seed) => Strike(seed);

	// A strike from `seed`; `dist` and `angle` (radians round from +x toward +z) put it somewhere
	// on purpose instead (pictures). Returns how far from the camera it landed.
	public float Strike(double seed, float? dist = null, float? angle = null)
	{
		var cam = GetViewport()?.GetCamera3D();
		if (cam == null || Gen == null) return 0;
		var r = new Random((int)(seed * 1e6));
		float R() => (float)r.NextDouble();
		bool near = R() < 0.22;
		float ang = R() * Mathf.Tau;
		float d = near ? (R() < 0.3 ? 20 + R() * 30 : 50 + R() * 130) : 300 + R() * 1500;
		if (dist is float fd)
		{
			d = fd;
			near = d < 250;
		}
		if (angle is float fa) ang = fa;
		var c = cam.GlobalPosition;
		var at = new Vector3(c.X + Mathf.Cos(ang) * d, 0, c.Z + Mathf.Sin(ang) * d);
		var (wx, wz) = WorldOrigin.ToWorld(at);
		at.Y = (float)Gen.Height(wx, wz);
		_at.Position = at;

		// a random walk toward the ground: sharp kinks, not a smooth curve
		float H = near ? 520 : 900;
		var top = new Vector3((R() - 0.5f) * 200, H, (R() - 0.5f) * 200);
		List<Vector3> Channel(Vector3 from, Vector3 to, int steps, float jag)
		{
			var pts = new List<Vector3> { from };
			var p = from;
			for (int i = 1; i <= steps; i++)
			{
				var aim = from.Lerp(to, i / (float)steps);
				p = p.Lerp(aim, 0.55f) + new Vector3((R() - 0.5f) * jag, (R() - 0.3f) * jag * 0.25f, (R() - 0.5f) * jag);
				pts.Add(p);
			}
			pts[^1] = to;
			return pts;
		}
		var main = Channel(top, Vector3.Zero, 44, near ? 22 : 34);
		var core = new MeshBuilder();
		var halo = new MeshBuilder();
		void Tube(MeshBuilder mb, List<Vector3> pts, float rad, int radial)
		{
			int n0 = mb.VertexCount;
			mb.Tube(pts, rad, radial);
			for (int i = n0; i < mb.VertexCount; i++) mb.Uv2.Add(new Vector2(rad, 0));
		}
		Tube(core, main, near ? 0.35f : 0.7f, 5);
		Tube(halo, main, near ? 3f : 6f, 8);
		// forks that die out in the air
		int forks = 2 + (int)(R() * 3);
		for (int b = 0; b < forks; b++)
		{
			int k = 3 + (int)(R() * (main.Count - 8));
			var from = main[k];
			float len = H / main.Count * (4 + R() * 6);
			var to = from + new Vector3((R() - 0.5f) * len, -len * (0.5f + R() * 0.4f), (R() - 0.5f) * len);
			Tube(core, Channel(from, to, 12, 14), near ? 0.2f : 0.4f, 4);
		}
		var mesh = core.ToMesh();
		mesh.SurfaceSetMaterial(0, _core);
		halo.ToMesh(mesh);
		mesh.SurfaceSetMaterial(1, _halo);
		_bolt.Mesh = mesh;
		_bolt.Visible = true;
		_t = _len = 0.55f;
		_near = near;
		_light.Visible = near;
		if (near)
		{
			if (Hold)
			{
				// (a picture: sparks and smoke as they are a moment after, standing still)
				_sparks.Preprocess = 0.35;
				_smoke.Preprocess = 1.5;
				_sparks.SpeedScale = _smoke.SpeedScale = 0;
			}
			_sparks.Restart();
			_smoke.Restart();
		}
		Pulse(1);
		return d;
	}

	public override void _Process(double delta)
	{
		if (!_bolt.Visible) return;
		if (Hold)
		{
			Pulse(1);
			return;
		}
		_t -= (float)delta;
		if (_t <= 0)
		{
			_bolt.Visible = false;
			_light.Visible = false;
			return;
		}
		// return strokes: bright, dim, bright again, fading
		float t = 1 - _t / _len;
		bool stroke = t < 0.12f || (t > 0.3f && t < 0.4f) || (t > 0.58f && t < 0.64f);
		Pulse(Math.Max(0, 1 - t * 1.4f) * (stroke ? 1 : 0.25f) * (0.75f + 0.25f * (float)_flicker.NextDouble()));
	}

	void Pulse(float k)
	{
		_core.SetShaderParameter("strength", k);
		_halo.SetShaderParameter("strength", k * 0.4f);
		if (_near) _light.LightEnergy = k * LightEnergy;
	}

	// Where it lands: sparks thrown up and falling back, glowing.
	public static GpuParticles3D MakeSparks()
	{
		var fade = new Gradient();
		fade.SetColor(0, new Color(1, 1, 1, 1));
		fade.SetColor(1, new Color(1, 0.5f, 0.2f, 0));
		var pm = new ParticleProcessMaterial
		{
			EmissionShape = ParticleProcessMaterial.EmissionShapeEnum.Sphere,
			EmissionSphereRadius = 0.3f,
			Direction = Vector3.Up,
			Spread = 65,
			InitialVelocityMin = 4,
			InitialVelocityMax = 13,
			Gravity = new Vector3(0, -9.8f, 0),
			DampingMin = 0.5f,
			DampingMax = 1,
			ColorRamp = new GradientTexture1D { Gradient = fade },
		};
		var mat = new StandardMaterial3D
		{
			ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
			BillboardMode = BaseMaterial3D.BillboardModeEnum.Particles,
			Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
			BlendMode = BaseMaterial3D.BlendModeEnum.Add,
			VertexColorUseAsAlbedo = true,
			AlbedoColor = new Color(3f, 2.55f, 1.8f),
			AlbedoTexture = SoftDot(),
		};
		return new GpuParticles3D
		{
			Name = "Sparks",
			Amount = 60,
			Lifetime = 1.4,
			OneShot = true,
			Explosiveness = 1,
			Emitting = false,
			LocalCoords = true,
			ProcessMaterial = pm,
			DrawPass1 = new QuadMesh { Size = new Vector2(0.16f, 0.16f), Material = mat },
			VisibilityAabb = new Aabb(new Vector3(-20, -2, -20), new Vector3(40, 22, 40)),
			CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
		};
	}

	// ...and a puff of grey smoke rising and spreading.
	public static GpuParticles3D MakeSmoke()
	{
		var fade = new Gradient();
		fade.SetColor(0, new Color(1, 1, 1, 0));
		fade.AddPoint(0.08f, new Color(1, 1, 1, 0.5f));
		fade.AddPoint(0.5f, new Color(1, 1, 1, 0.3f));
		fade.SetColor(fade.GetPointCount() - 1, new Color(1, 1, 1, 0));
		var grow = new Curve();
		grow.AddPoint(new Vector2(0, 0.3f));
		grow.AddPoint(new Vector2(1, 1));
		var pm = new ParticleProcessMaterial
		{
			EmissionShape = ParticleProcessMaterial.EmissionShapeEnum.Box,
			EmissionBoxExtents = new Vector3(1.2f, 0.4f, 1.2f),
			Direction = Vector3.Up,
			Spread = 30,
			InitialVelocityMin = 1.2f,
			InitialVelocityMax = 3,
			Gravity = new Vector3(0, 0.1f, 0),
			DampingMin = 0.4f,
			DampingMax = 0.8f,
			ScaleMin = 3,
			ScaleMax = 5,
			ScaleCurve = new CurveTexture { Curve = grow },
			AngleMin = -180,
			AngleMax = 180,
			ColorRamp = new GradientTexture1D { Gradient = fade },
		};
		var mat = new ShaderMaterial { Shader = GD.Load<Shader>("res://shaders/smoke.gdshader") };
		mat.SetShaderParameter("tint", new Color(0.32f, 0.31f, 0.3f));
		return new GpuParticles3D
		{
			Name = "Smoke",
			Amount = 16,
			Lifetime = 7,
			Randomness = 0.3f,
			OneShot = true,
			Explosiveness = 0.9f,
			Emitting = false,
			LocalCoords = true,
			ProcessMaterial = pm,
			DrawPass1 = new QuadMesh { Size = Vector2.One, Material = mat },
			VisibilityAabb = new Aabb(new Vector3(-30, -2, -30), new Vector3(60, 40, 60)),
			CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
		};
	}

	static GradientTexture2D SoftDot()
	{
		var g = new Gradient();
		g.SetColor(0, new Color(1, 1, 1, 1));
		g.SetColor(1, new Color(1, 1, 1, 0));
		return new GradientTexture2D
		{
			Gradient = g,
			Fill = GradientTexture2D.FillEnum.Radial,
			FillFrom = new Vector2(0.5f, 0.5f),
			FillTo = new Vector2(1, 0.5f),
			Width = 64,
			Height = 64,
		};
	}
}
