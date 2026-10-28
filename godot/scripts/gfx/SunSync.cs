using Godot;

namespace DustRoad.Gfx;

// Hands the sun and the sky's colours to the shaders that light themselves (water): the global
// shader uniforms sun_direction (the way the light travels), sun_color (linear, times the energy),
// sky_top and sky_horizon (linear), taken from the light this sits on and the scene's sky.
[Tool]
public partial class SunSync : DirectionalLight3D
{
	[Export] public NodePath Environment = "../WorldEnvironment";

	public override void _Process(double delta)
	{
		RenderingServer.GlobalShaderParameterSet("sun_direction", -GlobalBasis.Z.Normalized());
		var c = LightColor.SrgbToLinear();
		float e = Visible ? LightEnergy : 0;
		RenderingServer.GlobalShaderParameterSet("sun_color", new Vector3(c.R, c.G, c.B) * e);
		if (GetNodeOrNull<WorldEnvironment>(Environment)?.Environment?.Sky?.SkyMaterial is ProceduralSkyMaterial sky)
		{
			var top = sky.SkyTopColor.SrgbToLinear();
			var hor = sky.SkyHorizonColor.SrgbToLinear();
			RenderingServer.GlobalShaderParameterSet("sky_top", new Vector3(top.R, top.G, top.B) * sky.SkyEnergyMultiplier);
			RenderingServer.GlobalShaderParameterSet("sky_horizon", new Vector3(hor.R, hor.G, hor.B) * sky.SkyEnergyMultiplier);
			RenderingServer.GlobalShaderParameterSet("sky_curve", sky.SkyCurve);
		}
	}
}
