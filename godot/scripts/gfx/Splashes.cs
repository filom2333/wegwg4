using System;
using Godot;
using DustRoad.World;

namespace DustRoad.Gfx;

// Raindrops landing round the camera: on the ground a tiny crown of droplets thrown up (and the
// faintest ring), on water a ring spreading out. Placed on the CPU where the drops land (the
// ground from WorldGen, a bridge deck by a ray, the water surface), drawn by
// shaders/splash_ring.gdshader and splash_crown.gdshader from one ring buffer of instances
// (custom data: the time it landed, a random number, 1 on water), so only the new ones are
// written each frame. Driven by Precipitation.
public partial class Splashes : MultiMeshInstance3D
{
	const int Max = 2048;
	const float Radius = 10;
	// landings a second in the heaviest rain (those within Radius that are worth drawing)
	const float Rate = 3600;
	// what a drop lands on besides the ground: structures (bridge decks; later floors and roofs)
	const uint Solid = 1u << 1;

	public WorldGen Gen;

	MultiMesh _mm;
	ShaderMaterial _ring, _crown;
	int _next;
	float _now, _owed;
	readonly Random _rand = new(31);

	public override void _Ready()
	{
		_ring = new ShaderMaterial { Shader = GD.Load<Shader>("res://shaders/splash_ring.gdshader") };
		_crown = new ShaderMaterial { Shader = GD.Load<Shader>("res://shaders/splash_crown.gdshader") };
		// one flat quad for the ring, one upright for the crown (it turns to the camera itself)
		var mb = new MeshBuilder();
		mb.Quad(new Vector3(-0.5f, 0, -0.5f), new Vector3(0.5f, 0, -0.5f), new Vector3(0.5f, 0, 0.5f), new Vector3(-0.5f, 0, 0.5f), Vector3.Up);
		var mesh = mb.ToMesh();
		mesh.SurfaceSetMaterial(0, _ring);
		var up = new MeshBuilder();
		up.Quad(new Vector3(-0.5f, 0, 0), new Vector3(0.5f, 0, 0), new Vector3(0.5f, 1, 0), new Vector3(-0.5f, 1, 0), Vector3.Back);
		up.ToMesh(mesh);
		mesh.SurfaceSetMaterial(1, _crown);
		mesh.CustomAabb = new Aabb(new Vector3(-1, -0.5f, -1), new Vector3(2, 1.5f, 2));
		_mm = new MultiMesh
		{
			TransformFormat = MultiMesh.TransformFormatEnum.Transform3D,
			UseCustomData = true,
			InstanceCount = Max,
			Mesh = mesh,
		};
		var gone = new Color(-100, 0, 0, 0);
		for (int i = 0; i < Max; i++)
		{
			_mm.SetInstanceTransform(i, new Transform3D(Basis.Identity, new Vector3(0, -1e4f, 0)));
			_mm.SetInstanceCustomData(i, gone);
		}
		Multimesh = _mm;
		CastShadow = ShadowCastingSetting.Off;
		// (the instances sit round the camera wherever it is)
		CustomAabb = new Aabb(new Vector3(-1e5f, -1e4f, -1e5f), new Vector3(2e5f, 2e4f, 2e5f));
		WorldOrigin.Shifted += OnShifted;
	}

	public override void _ExitTree() => WorldOrigin.Shifted -= OnShifted;

	// (they last a fraction of a second: on a shift of the origin the ones in the air are dropped)
	void OnShifted(double dx, double dz)
	{
		var gone = new Color(-100, 0, 0, 0);
		for (int i = 0; i < Max; i++) _mm.SetInstanceCustomData(i, gone);
	}

	// One frame of `amount` rain (0..1) seen in `light` (0..1).
	public void Step(float dt, float amount, float light, Camera3D cam)
	{
		_now += dt;
		// (keep the clock small enough for a float's precision)
		if (_now > 1e4f)
		{
			_now = 0;
			OnShifted(0, 0);
		}
		_ring.SetShaderParameter("now", _now);
		_crown.SetShaderParameter("now", _now);
		_ring.SetShaderParameter("light_level", light);
		_crown.SetShaderParameter("light_level", light);
		Visible = amount > 0.01f;
		if (!Visible || Gen == null || cam == null) return;
		_owed += Rate * amount * dt;
		int n = Math.Min((int)_owed, Max);
		_owed -= (int)_owed;
		var c = cam.GlobalPosition;
		var space = GetWorld3D().DirectSpaceState;
		float R() => (float)_rand.NextDouble();
		for (int i = 0; i < n; i++)
		{
			float a = R() * Mathf.Tau, r = Radius * Mathf.Sqrt(R());
			var p = new Vector3(c.X + Mathf.Cos(a) * r, 0, c.Z + Mathf.Sin(a) * r);
			var (wx, wz) = WorldOrigin.ToWorld(p);
			float y = (float)Gen.Height(wx, wz);
			bool water = false;
			var w = Gen.WaterAt(wx, wz);
			if (w is WaterHit wh && !wh.Frozen && wh.Level > y)
			{
				y = (float)wh.Level;
				water = true;
			}
			var q = PhysicsRayQueryParameters3D.Create(new Vector3(p.X, c.Y + 20, p.Z), new Vector3(p.X, y, p.Z), Solid);
			var hit = space.IntersectRay(q);
			if (hit.Count > 0)
			{
				y = hit["position"].AsVector3().Y;
				water = false;
			}
			// too far below or above to be seen landing
			if (Math.Abs(y - c.Y) > 6) continue;
			p.Y = y + 0.01f;
			// (landed somewhen during this frame: in slow frames they would all start together)
			float born = _now - R() * Math.Min(dt, 0.5f);
			float size = water ? 0.22f + R() * 0.2f : 0.15f + R() * 0.08f;
			_mm.SetInstanceTransform(_next, new Transform3D(Basis.Identity.Scaled(new Vector3(size, size, size)), p));
			_mm.SetInstanceCustomData(_next, new Color(born, R(), water ? 1 : 0, 0));
			_next = (_next + 1) % Max;
		}
	}
}
