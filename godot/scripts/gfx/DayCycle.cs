using System;
using System.Collections.Generic;
using Godot;
using DustRoad.World;

namespace DustRoad.Gfx;

// The day and the weather: the hour (and the sun and moon it puts where), the sky shader's
// state, the sunlight and moonlight, the sky's light on everything, fog, exposure, the wind; the
// weather drifting from one kind to the next as the biome allows. A port of
// web/src/gfx/environment.js. Runs in the editor too (without the clock): set Time and Weather
// in the inspector to see the scene at any hour.
//
// Lights are scaled to this project's calibration (shot against the browser version at the
// start): the browser's sun of 4.1 is 1.85 here, its sky light of 0.54 an ambient of 0.67.
[Tool]
public partial class DayCycle : Node
{
	public sealed class WeatherState
	{
		public float Cloud, Overcast, Dust, Rain, Wind, Turbidity, FogDensity, Mist;
		public bool Lightning;

		public WeatherState Copy() => (WeatherState)MemberwiseClone();
	}

	public static readonly Dictionary<string, WeatherState> Weathers = new()
	{
		["clear"] = new() { Cloud = 0.3f, Wind = 0.25f, Turbidity = 2.5f, FogDensity = 0.00013f },
		["hazy"] = new() { Cloud = 0.25f, Overcast = 0.1f, Dust = 0.12f, Wind = 0.35f, Turbidity = 5, FogDensity = 0.00022f },
		["cloudy"] = new() { Cloud = 0.6f, Overcast = 0.25f, Wind = 0.45f, Turbidity = 3, FogDensity = 0.00016f },
		["fog"] = new() { Cloud = 0.85f, Overcast = 0.6f, Rain = 0.04f, Wind = 0.08f, Turbidity = 3, FogDensity = 0.0026f, Mist = 0.8f },
		["rain"] = new() { Cloud = 0.9f, Overcast = 0.75f, Rain = 0.65f, Wind = 0.6f, Turbidity = 3, FogDensity = 0.0006f, Mist = 0.15f },
		["storm"] = new() { Cloud = 1.0f, Overcast = 0.95f, Rain = 1.0f, Wind = 0.95f, Turbidity = 3, FogDensity = 0.0011f, Lightning = true },
		["sandstorm"] = new() { Cloud = 0.4f, Overcast = 0.45f, Dust = 0.9f, Wind = 1.0f, Turbidity = 9, FogDensity = 0.016f },
		// in the north the "rain" falls as snow
		["snow"] = new() { Cloud = 0.92f, Overcast = 0.72f, Rain = 0.8f, Wind = 0.35f, Turbidity = 3, FogDensity = 0.0019f, Mist = 0.12f },
	};

	const double Lat = 34 * Math.PI / 180, Dec = 12 * Math.PI / 180;
	const float SunScale = 0.248f, SkyLightScale = 0.688f, FogScale = 0.85f;

	[Export(PropertyHint.Range, "0,24,0.01")] public float Time = 9.5f;
	// game hours per real minute (24 minutes a day)
	[Export] public float TimeScale = 0.5f;
	[Export(PropertyHint.Enum, "clear,hazy,cloudy,fog,rain,storm,sandstorm,snow")] public string Weather = "clear";
	// keep the weather as it is (no drifting to the next)
	[Export] public bool LockWeather;
	[Export] public NodePath SunPath = "../Sun";
	[Export] public NodePath MoonPath = "../Moon";
	[Export] public NodePath EnvironmentPath = "../WorldEnvironment";

	public int Day = 1;
	// where the camera is: what weather can come (set by Main)
	public Biome Biome = Biome.Scrub;
	public WeatherState W = Weathers["clear"].Copy();
	public Vector3 SunDir, MoonDir;
	public float Daylight => Smooth(-0.12f, 0.12f, SunDir.Y);
	public bool IsNight => SunDir.Y < -0.05f;
	public float Flash;
	// rain or snow? (snow in the north and on snow days)
	public bool Snowing => Weather == "snow" || Biome is Biome.Taiga or Biome.Tundra;
	// how wet the ground is: up quickly in the rain, drying over minutes after
	public float Wetness;
	// morning mist lying in the low places (0..1), and the ground under the camera it lies on
	public float Mist;
	public float GroundHeight;
	// no easing in: everything at once (pictures, the editor)
	public bool Instant;

	// biomes where mornings are often misty: the chance of mist on a given morning
	static readonly Dictionary<Biome, float> Misty = new()
	{
		[Biome.Forest] = 0.55f,
		[Biome.Taiga] = 0.45f,
		[Biome.Prairie] = 0.4f,
		[Biome.Tundra] = 0.3f,
		[Biome.Highland] = 0.25f,
		[Biome.Scrub] = 0.06f,
	};
	float _mistToday;
	int _mistDay = -1;

	WeatherState _target = Weathers["clear"].Copy();
	string _applied;
	float _weatherTimer, _nextWeatherIn = 1.2f, _lightningTimer = 3;
	double _cloudTime;
	readonly Random _rand = new(77);
	ShaderMaterial _sky;

	static float Smooth(float a, float b, float x)
	{
		float t = Math.Clamp((x - a) / (b - a), 0, 1);
		return t * t * (3 - 2 * t);
	}

	static float Lerp(float a, float b, float t) => a + (b - a) * t;

	// The way to the sun at an hour of the day (x west, y up, z north), at 34° north in early May.
	public static Vector3 SunDirection(double time)
	{
		double h = (time - 12) / 24 * Math.PI * 2;
		double e = -Math.Cos(Dec) * Math.Sin(h);
		double n = Math.Sin(Dec) * Math.Cos(Lat) - Math.Cos(Dec) * Math.Sin(Lat) * Math.Cos(h);
		double u = Math.Sin(Lat) * Math.Sin(Dec) + Math.Cos(Lat) * Math.Cos(Dec) * Math.Cos(h);
		return new Vector3((float)-e, (float)u, (float)n).Normalized();
	}

	public void SetWeather(string name, bool instant = false)
	{
		if (!Weathers.ContainsKey(name)) return;
		Weather = name;
		_target = Weathers[name].Copy();
		if (instant) W = _target.Copy();
		_applied = name;
	}

	string NextWeather()
	{
		(string, float)[] table = Biome switch
		{
			Biome.Dunes or Biome.Badlands => new[] { ("clear", 4f), ("hazy", 2f), ("cloudy", 1f), ("sandstorm", 1.3f), ("storm", 0.4f) },
			Biome.Saltflat => new[] { ("clear", 4f), ("hazy", 2f), ("cloudy", 1f), ("rain", 0.5f), ("storm", 0.6f) },
			Biome.Taiga or Biome.Tundra => new[] { ("clear", 3f), ("cloudy", 2f), ("snow", 2.8f), ("fog", 0.6f) },
			Biome.Forest or Biome.Prairie => new[] { ("clear", 4f), ("cloudy", 2f), ("fog", 0.8f), ("rain", 1.2f), ("storm", 0.5f) },
			_ => new[] { ("clear", 4f), ("cloudy", 2f), ("hazy", 1f), ("rain", 1.1f), ("storm", 0.6f), ("sandstorm", 0.45f) },
		};
		float tot = 0;
		foreach (var (_, w) in table) tot += w;
		float p = (float)_rand.NextDouble() * tot;
		foreach (var (n, w) in table)
			if ((p -= w) <= 0) return n;
		return "clear";
	}

	public override void _Process(double delta)
	{
		bool editor = Engine.IsEditorHint();
		float dt = (float)delta;
		float dh = editor ? 0 : dt / 60 * TimeScale;
		Time += dh;
		if (Time >= 24)
		{
			Time -= 24;
			Day++;
		}
		// the weather: picked in the inspector, or drifting on by itself
		if (_applied != Weather) SetWeather(Weather, editor || _applied == null);
		if (!editor && !LockWeather)
		{
			_weatherTimer += dh;
			if (_weatherTimer > _nextWeatherIn)
			{
				_weatherTimer = 0;
				_nextWeatherIn = 1.5f + (float)_rand.NextDouble() * 4;
				SetWeather(NextWeather());
			}
		}
		float k = editor ? 1 : Math.Min(1, dt * 0.08f + Math.Abs(dh) * 0.6f);
		W.Cloud = Lerp(W.Cloud, _target.Cloud, k);
		W.Overcast = Lerp(W.Overcast, _target.Overcast, k);
		W.Dust = Lerp(W.Dust, _target.Dust, k);
		W.Rain = Lerp(W.Rain, _target.Rain, k);
		W.Wind = Lerp(W.Wind, _target.Wind, k);
		W.Turbidity = Lerp(W.Turbidity, _target.Turbidity, k);
		W.FogDensity = Lerp(W.FogDensity, _target.FogDensity, k);
		W.Mist = Lerp(W.Mist, _target.Mist, k);
		W.Lightning = _target.Lightning;

		// the ground: wet in the rain (snow lies instead), drying slowly
		bool instant = editor || Instant;
		float wetTo = Snowing ? 0 : Math.Min(1, W.Rain * 1.6f);
		Wetness = instant ? wetTo : Wetness + (wetTo - Wetness) * Math.Min(1, dt * (wetTo > Wetness ? 0.05f : 0.004f));
		// morning mist in green country: decided each night, rising before dawn, burning off through
		// the morning
		if (Day != _mistDay && Time > 1 && Time < 3)
		{
			_mistDay = Day;
			_mistToday = _rand.NextDouble() < Misty.GetValueOrDefault(Biome, 0.04f) ? 0.55f + (float)_rand.NextDouble() * 0.45f : 0;
		}
		float morning = Smooth(2.5f, 5.2f, Time) * (1 - Smooth(7.4f, 10.2f, Time));
		float mistTo = Math.Max(W.Mist, morning * _mistToday * (1 - W.Wind) * (1 - W.Dust));
		Mist = instant ? mistTo : Mist + (mistTo - Mist) * Math.Min(1, dt * 0.2f);

		SunDir = SunDirection(Time);
		MoonDir = new Vector3(-SunDir.X * 0.9f + 0.2f, -SunDir.Y, -SunDir.Z * 0.9f + 0.1f).Normalized();
		float night = 1 - Smooth(-0.2f, 0.0f, SunDir.Y);

		// lightning in a storm
		Flash = Math.Max(0, Flash - dt * 6);
		if (!editor && W.Lightning && W.Rain > 0.6f)
		{
			_lightningTimer -= dt;
			if (_lightningTimer <= 0)
			{
				_lightningTimer = 4 + (float)_rand.NextDouble() * 12;
				Flash = _rand.NextDouble() < 0.25 ? 1.7f : 1f;
			}
		}
		_cloudTime += editor ? 0 : delta;

		float day = Daylight;
		float sunY = SunDir.Y;
		float warm = 1 - Smooth(0.0f, 0.4f, sunY);
		ApplySky(night);
		ApplyLights(day, warm, sunY, night);
		ApplyAir(day, warm, sunY, night);
	}

	void ApplySky(float night)
	{
		var env = GetNodeOrNull<WorldEnvironment>(EnvironmentPath)?.Environment;
		if (env == null) return;
		if (env.Sky?.SkyMaterial is ShaderMaterial sm) _sky = sm;
		if (_sky == null) return;
		_sky.SetShaderParameter("sun_dir", SunDir);
		_sky.SetShaderParameter("moon_dir", MoonDir);
		_sky.SetShaderParameter("cloud", W.Cloud);
		_sky.SetShaderParameter("overcast", W.Overcast);
		_sky.SetShaderParameter("dust", W.Dust);
		// thick dust is darker and redder than a light haze
		var dustCol = new Vector3(0.78f, 0.62f, 0.45f).Lerp(new Vector3(0.58f, 0.41f, 0.25f), Smooth(0.3f, 0.9f, W.Dust));
		_sky.SetShaderParameter("dust_color", dustCol);
		_sky.SetShaderParameter("turbidity", W.Turbidity);
		_sky.SetShaderParameter("night", night);
		_sky.SetShaderParameter("stars", 1 - W.Overcast);
		_sky.SetShaderParameter("flash", Flash * 0.6f);
		_sky.SetShaderParameter("mist", Mist);
		_sky.SetShaderParameter("cloud_time", (float)(_cloudTime % 100000));
	}

	void ApplyLights(float day, float warm, float sunY, float night)
	{
		float cover = 1 - W.Overcast * 0.85f - W.Dust * 0.5f;
		var sunLin = new Color(1.0f, 0.94f, 0.84f).Lerp(new Color(1.0f, 0.52f, 0.24f), warm);
		float sunE = (4.1f + 0.8f * warm) * Smooth(-0.03f, 0.1f, sunY) * Math.Max(0.05f, cover) * SunScale;
		if (GetNodeOrNull<DirectionalLight3D>(SunPath) is { } sun)
		{
			sun.LightColor = sunLin.LinearToSrgb();
			sun.LightEnergy = sunE;
			sun.Visible = sunE > 0.002f;
			// (the light shines down the node's -z: from the sun toward the land)
			sun.GlobalBasis = Basis.LookingAt(-SunDir, Mathf.Abs(SunDir.Y) > 0.99f ? Vector3.Forward : Vector3.Up);
		}
		float moonUp = Smooth(-0.05f, 0.15f, MoonDir.Y);
		float moonE = 0.8f * moonUp * night * (1 - W.Overcast * 0.75f) * SunScale;
		if (GetNodeOrNull<DirectionalLight3D>(MoonPath) is { } moon)
		{
			moon.LightEnergy = moonE;
			moon.Visible = moonE > 0.002f;
			moon.GlobalBasis = Basis.LookingAt(-MoonDir, Mathf.Abs(MoonDir.Y) > 0.99f ? Vector3.Forward : Vector3.Up);
		}
		// what the water shader lights itself with
		RenderingServer.GlobalShaderParameterSet("sun_direction", -SunDir);
		RenderingServer.GlobalShaderParameterSet("sun_color", new Vector3(sunLin.R, sunLin.G, sunLin.B) * sunE);
	}

	void ApplyAir(float day, float warm, float sunY, float night)
	{
		var env = GetNodeOrNull<WorldEnvironment>(EnvironmentPath)?.Environment;
		if (env == null) return;
		// the sky's light on everything (one colour: see HANDOFF, the lighting gotcha)
		var skyCol = new Color(0.46f, 0.55f, 0.68f).Lerp(new Color(0.55f, 0.57f, 0.6f), W.Overcast);
		skyCol = skyCol.Lerp(new Color(0.75f, 0.58f, 0.48f), warm * day * 0.6f);
		skyCol = skyCol.Lerp(new Color(0.7f, 0.55f, 0.4f), W.Dust * 0.8f);
		var nightSky = new Color(0.075f, 0.095f, 0.15f);
		var amb = nightSky.Lerp(skyCol, day);
		float twilight = Smooth(-0.16f, 0.0f, sunY) * (1 - Smooth(0.0f, 0.25f, sunY));
		float ambE = ((0.42f + 0.12f * day + 0.55f * twilight) * (1 - W.Dust * 0.35f) + Flash * 2.5f) * SkyLightScale;
		env.AmbientLightColor = amb.LinearToSrgb();
		env.AmbientLightEnergy = ambE;
		// fog: the sky's own colour just above the horizon (as shaders/sky.gdshader paints it, with
		// its overcast, dust and mist), so far hills fade into the sky behind them
		float sd = Smooth(-0.12f, 0.25f, sunY);
		var zen = new Vector3(0.012f, 0.018f, 0.04f).Lerp(new Vector3(0.16f, 0.38f, 0.82f), sd);
		var hor = new Vector3(0.03f, 0.04f, 0.07f).Lerp(new Vector3(0.74f, 0.8f, 0.86f), sd);
		float low = Smooth(0.35f, 0.0f, Math.Abs(sunY)) * Smooth(-0.2f, 0.02f, sunY);
		// (round the horizon on average: the warm glow is strongest toward the sun)
		hor = hor.Lerp(new Vector3(1.0f, 0.55f, 0.28f), low * 0.6f);
		zen = zen.Lerp(new Vector3(0.18f, 0.24f, 0.42f), low * 0.5f);
		var grey = new Vector3(0.03f, 0.035f, 0.045f).Lerp(new Vector3(0.55f, 0.57f, 0.6f), Smooth(-0.1f, 0.3f, sunY)) * (1 - 0.45f * Smooth(0.6f, 1.0f, W.Overcast));
		var dustCol = new Vector3(0.78f, 0.62f, 0.45f).Lerp(new Vector3(0.58f, 0.41f, 0.25f), Smooth(0.3f, 0.9f, W.Dust)) * Lerp(0.06f, 1.0f, Smooth(-0.1f, 0.3f, sunY));
		var mistCol = new Vector3(0.05f, 0.055f, 0.07f).Lerp(new Vector3(0.8f, 0.82f, 0.85f), Smooth(-0.1f, 0.25f, sunY));
		Vector3 Weather(Vector3 c, float up)
		{
			c = c.Lerp(grey * (0.85f + 0.15f * up), W.Overcast * 0.85f);
			c = c.Lerp(dustCol, W.Dust * (0.72f + 0.28f * (1 - up)));
			return c.Lerp(mistCol, Mist * 0.85f * (1 - Smooth(0.0f, 0.6f, up) * 0.65f));
		}
		var fogHor = Weather(hor, 0.02f);
		float gain = _sky != null ? _sky.GetShaderParameter("gain").AsSingle() : 1;
		var fog = fogHor * gain;
		env.FogLightColor = new Color(fog.X, fog.Y, fog.Z).LinearToSrgb();
		env.FogDensity = W.FogDensity * (1 + night * 0.6f) * FogScale;
		// the mist: height fog lying below the ground you stand on, so it fills the hollows
		env.FogHeight = GroundHeight - 1;
		env.FogHeightDensity = Mist * 0.25f;
		env.TonemapExposure = Lerp(1.42f, 0.98f, day) * (1 + 0.12f * warm * day) * (1 + Flash * 0.3f) / 0.98f;
		// the water's sky: the same zenith and horizon
		RenderingServer.GlobalShaderParameterSet("sky_top", Weather(zen, 1.0f) * gain);
		RenderingServer.GlobalShaderParameterSet("sky_horizon", fogHor * gain);
		RenderingServer.GlobalShaderParameterSet("sky_curve", 3.2f + W.Turbidity * 0.2f);
		RenderingServer.GlobalShaderParameterSet("wind", W.Wind);
		RenderingServer.GlobalShaderParameterSet("wetness", Wetness);
	}
}
