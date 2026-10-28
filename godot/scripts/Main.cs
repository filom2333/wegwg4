using System;
using System.Globalization;
using Godot;
using DustRoad.Gfx;
using DustRoad.Player;
using DustRoad.World;

namespace DustRoad;

// The game's root: the world seed, the floating origin that follows the camera, and (for checking
// the picture) a picture taken from the command line:
//   godot --path godot -- --shot=out.png [--at=x,z | --at=road,z] [--yaw=deg] [--pitch=deg] [--fly=height]
//   (--bolt=metres: a lightning bolt that far ahead)
public partial class Main : Node3D
{
	[Export] public int Seed = 1234;
	// start: the homestead by the road at the south end
	[Export] public Vector2 StartXZ = new(4, 6);
	[Export] public float StartYaw = 0;

	WorldGen _gen;
	Camera3D _cam;
	TerrainStreamer _terrain;
	ScatterStreamer _scatter;
	DayCycle _day;
	double _biomeCheck;
	string _shot;
	int _shotFrames = -1;
	int _shotAfter = 5;
	double _shotWait;
	// a lightning bolt for the picture: how far ahead
	float _bolt = -1;

	public override void _Ready()
	{
		WorldOrigin.Reset();
		_gen = new WorldGen(Seed);
		_terrain = GetNode<TerrainStreamer>("World/Terrain");
		_terrain.Seed = Seed;
		GetNode<RoadStreamer>("World/Road").Seed = Seed;
		GetNode<WaterStreamer>("World/Water").Seed = Seed;
		GetNode<BridgeStreamer>("World/Bridges").Seed = Seed;
		_day = GetNode<DayCycle>("DayCycle");
		_scatter = GetNode<ScatterStreamer>("World/Scatter");
		_scatter.Seed = Seed;
		_cam = GetNode<Camera3D>("Player");
		GetNode<Lightning>("Lightning").Gen = _gen;
		GetNode<Precipitation>("Precipitation").Gen = _gen;
		WorldOrigin.Shifted += OnOriginShifted;

		double x = StartXZ.X, z = StartXZ.Y;
		float yaw = StartYaw, pitch = -4;
		float fly = 0;
		foreach (var arg in OS.GetCmdlineUserArgs())
		{
			string v = arg.Contains('=') ? arg[(arg.IndexOf('=') + 1)..] : "";
			var ci = CultureInfo.InvariantCulture;
			if (arg.StartsWith("--shot=")) _shot = v;
			else if (arg.StartsWith("--at="))
			{
				// (x "road": on the road at that z)
				var p = v.Split(',');
				z = double.Parse(p[1], ci);
				x = p[0] == "road" ? _gen.RoadX(z) : double.Parse(p[0], ci);
			}
			else if (arg.StartsWith("--yaw=")) yaw = float.Parse(v, ci);
			else if (arg.StartsWith("--pitch=")) pitch = float.Parse(v, ci);
			else if (arg.StartsWith("--fly=")) fly = float.Parse(v, ci);
			else if (arg == "--noshadow") GetNode<DirectionalLight3D>("Sun").ShadowEnabled = false;
			else if (arg == "--nossao") GetNode<WorldEnvironment>("WorldEnvironment").Environment.SsaoEnabled = false;
			else if (arg == "--nosun") GetNode<DirectionalLight3D>("Sun").Visible = false;
			else if (arg.StartsWith("--frames=")) _shotAfter = int.Parse(v, ci);
			else if (arg == "--ambientbg") GetNode<WorldEnvironment>("WorldEnvironment").Environment.AmbientLightSource = Godot.Environment.AmbientSource.Bg;
			else if (arg == "--ambientcolor")
			{
				var env = GetNode<WorldEnvironment>("WorldEnvironment").Environment;
				env.AmbientLightSource = Godot.Environment.AmbientSource.Color;
				env.AmbientLightColor = new Color(0.55f, 0.62f, 0.72f);
			}
			else if (arg.StartsWith("--time=")) _day.Time = float.Parse(v, ci);
			else if (arg.StartsWith("--weather=")) _day.Weather = v;
			else if (arg == "--noday") _day.ProcessMode = ProcessModeEnum.Disabled;
			else if (arg == "--noprecip") GetNode<Node3D>("Precipitation").Visible = false;
			else if (arg == "--nomsaa") GetViewport().Msaa3D = Viewport.Msaa.Disabled;
			else if (arg.StartsWith("--scatteronly=")) ScatterStreamer.Only = v;
			else if (arg.StartsWith("--bolt=")) _bolt = float.Parse(v, ci);
			else if (arg.StartsWith("--debug=")) ((ShaderMaterial)_terrain.TerrainMaterial).SetShaderParameter("debug_view", int.Parse(v, ci));
		}
		WorldOrigin.MoveTo(x, z);
		if (_shot != null)
		{
			// rendering without a graphics card takes seconds a frame: make everything in one go
			_terrain.BuildBudgetMs = 1e6f;
			_terrain.MaxInFlight = 100000;
			GetNode<RoadStreamer>("World/Road").MaxPerFrame = 1000;
			_day.TimeScale = 0;
			_day.LockWeather = true;
			_day.Instant = true;
		}
		if (_cam is Spectator s)
		{
			s.Setup(_gen, x, z, yaw, pitch);
			if (fly > 0)
			{
				s.Walking = false;
				s.Position += new Vector3(0, fly, 0);
			}
		}
	}

	public override void _ExitTree() => WorldOrigin.Shifted -= OnOriginShifted;

	void OnOriginShifted(double dx, double dz) => _cam.Position -= new Vector3((float)dx, 0, (float)dz);

	public override void _Process(double delta)
	{
		// keep the camera within a kilometre of the origin
		var p = _cam.Position;
		if (Math.Abs(p.X) > 1024 || Math.Abs(p.Z) > 1024)
		{
			var (wx, wz) = WorldOrigin.ToWorld(p);
			WorldOrigin.MoveTo(wx, wz);
		}
		// the weather that can come depends on where you are
		_biomeCheck -= delta;
		if (_biomeCheck <= 0)
		{
			_biomeCheck = 2;
			var (bx, bz) = WorldOrigin.ToWorld(_cam.GlobalPosition);
			_day.Biome = _gen.DominantBiome(bx, bz);
		}
		{
			var (gx, gz) = WorldOrigin.ToWorld(_cam.GlobalPosition);
			_day.GroundHeight = (float)_gen.Height(gx, gz);
		}
		if (_shot != null) TakeShot(delta);
	}

	// Once the ground around is built (and a few frames more for the shadows), save the picture.
	void TakeShot(double delta)
	{
		_shotWait += delta;
		if (_shotFrames < 0)
		{
			if (!(_terrain.AllBuilt && _scatter.AllBuilt) && _shotWait < 120) return;
			_shotFrames = 0;
			if (_bolt > 0)
			{
				var l = GetNode<Lightning>("Lightning");
				l.Hold = true;
				var f = -_cam.GlobalBasis.Z;
				l.Strike(0.37, _bolt, Mathf.Atan2(f.Z, f.X));
			}
		}
		if (++_shotFrames < _shotAfter) return;
		GetViewport().GetTexture().GetImage().SavePng(_shot);
		var sun = GetNode<DirectionalLight3D>("Sun");
		GD.Print($"shot saved: {_shot} ({_terrain.TileCount} tiles, {_shotWait:F1} s, {_day.Time:F2} h, {_day.Weather}, sun shadows {sun.ShadowEnabled})");
		var envr = GetNode<WorldEnvironment>("WorldEnvironment").Environment;
		GD.Print($"light: sun {sun.LightEnergy:F2} {sun.LightColor} dir {-sun.GlobalBasis.Z} ambient {envr.AmbientLightColor} x {envr.AmbientLightEnergy:F2} exposure {envr.TonemapExposure:F2} fog {envr.FogDensity:F6}");
		GD.Print($"frame: {RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalPrimitivesInFrame) / 1000} k triangles, {RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalDrawCallsInFrame)} draw calls, {RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalObjectsInFrame)} objects");
		GetTree().Quit();
		// (on the software driver Godot sometimes never finishes quitting, waiting on a pipeline
		// still compiling in its worker pool: the picture is saved, so end it)
		new System.Threading.Thread(() =>
		{
			System.Threading.Thread.Sleep(20000);
			System.Diagnostics.Process.GetCurrentProcess().Kill();
		}) { IsBackground = true }.Start();
	}
}
