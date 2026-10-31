using Godot;
using DustRoad.Gfx;

namespace DustRoad.Test;

// A bare stage for checking effects quickly without the world (renders in seconds on the
// software driver): godot --path . scenes/test/FxTest.tscn -- --shot=out.png [--fxtime=s]
// [--fxhold=s: sparks and smoke frozen that far in] [--fxbuilding=name: a building model instead]
public partial class FxTest : Node3D
{
	string _shot;
	int _frames;
	float _at = 0.4f;
	float _hold = -1;
	string _building;
	float _age = 0.3f;
	double _t;
	GpuParticles3D _sparks, _smoke;

	public override void _Ready()
	{
		foreach (var arg in OS.GetCmdlineUserArgs())
		{
			if (arg.StartsWith("--shot=")) _shot = arg[7..];
			if (arg.StartsWith("--fxtime=")) _at = float.Parse(arg[9..], System.Globalization.CultureInfo.InvariantCulture);
			if (arg.StartsWith("--fxhold=")) _hold = float.Parse(arg[9..], System.Globalization.CultureInfo.InvariantCulture);
			if (arg.StartsWith("--fxbuilding=")) _building = arg[13..];
			if (arg.StartsWith("--fxage=")) _age = float.Parse(arg[8..], System.Globalization.CultureInfo.InvariantCulture);
		}
		AddChild(new WorldEnvironment { Environment = new Environment { BackgroundMode = Environment.BGMode.Color, BackgroundColor = new Color(0.45f, 0.48f, 0.52f), AmbientLightSource = Environment.AmbientSource.Color, AmbientLightColor = new Color(0.6f, 0.62f, 0.66f), TonemapMode = Environment.ToneMapper.Aces, GlowEnabled = true } });
		AddChild(new DirectionalLight3D { RotationDegrees = new Vector3(-50, 30, 0), LightEnergy = 0.6f, ShadowEnabled = true, DirectionalShadowMaxDistance = 80 });
		AddChild(new MeshInstance3D { Mesh = new PlaneMesh { Size = new Vector2(80, 80) }, MaterialOverride = new StandardMaterial3D { AlbedoColor = new Color(0.55f, 0.45f, 0.33f) } });
		AddChild(new Camera3D { Position = new Vector3(0, 3, 16), RotationDegrees = new Vector3(-4, 0, 0), Current = true });
		if (_building != null)
		{
			// a building on the bare stage, its front to the camera
			var n = DustRoad.World.Places.BuildingLibrary.Instantiate(_building, _age, 0);
			AddChild(n);
			// three quarters from the front left
			var cam = GetViewport().GetCamera3D();
			var fp = DustRoad.World.Places.BuildingLibrary.GetMeta(_building).Footprint;
			float d = Mathf.Max(fp.X, fp.Y) * 0.7f + 2;
			cam.Position = new Vector3(-d * 0.6f, 2.2f, d * 0.85f);
			cam.LookAt(new Vector3(0, 1.8f, 0));
			return;
		}
		_sparks = Lightning.MakeSparks();
		_smoke = Lightning.MakeSmoke();
		AddChild(_sparks);
		AddChild(_smoke);
		if (_hold >= 0)
		{
			_sparks.Preprocess = _smoke.Preprocess = _hold;
			_sparks.SpeedScale = _smoke.SpeedScale = 0;
		}
		_sparks.Restart();
		_smoke.Restart();
	}

	public override void _Process(double delta)
	{
		_frames++;
		_t += delta;
		if (_frames == 3 && _sparks != null) GD.Print($"emitting {_sparks.Emitting} {_smoke.Emitting}, frame dt {delta:F3}");
		if (_frames <= 4) GD.Print($"frame {_frames} dt {delta:F3}");
		if (_shot == null || _t < _at) return;
		GetViewport().GetTexture().GetImage().SavePng(_shot);
		GD.Print($"fx shot saved at {_t:F2} s after {_frames} frames");
		GetTree().Quit();
	}
}
