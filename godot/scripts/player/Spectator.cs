using System;
using Godot;
using DustRoad.World;

namespace DustRoad.Player;

// A free camera for looking round the world until the player and the car are in: click to take
// the mouse, WASD to move, Q/E down and up, Shift for speed, G to walk on the ground (and on
// bridge decks) at eye height, Esc to let the mouse go.
public partial class Spectator : Camera3D
{
	[Export] public float Speed = 12;
	[Export] public float MouseSensitivity = 0.0022f;
	[Export] public bool Walking = true;
	[Export] public float EyeHeight = 1.64f;

	WorldGen _gen;
	float _yaw, _pitch;
	// the top of whatever solid stands under the camera (a bridge deck), NaN for none; just after
	// placing, looked for from high above so a start on a bridge lands on its deck
	float _deck = float.NaN;
	int _snapFrames;

	public void Setup(WorldGen gen, double x, double z, float yawDeg, float pitchDeg)
	{
		_gen = gen;
		_yaw = Mathf.DegToRad(yawDeg);
		_pitch = Mathf.DegToRad(pitchDeg);
		Position = WorldOrigin.ToScene(x, gen.Height(x, z) + EyeHeight, z);
		_snapFrames = 30;
		Apply();
	}

	// yaw 0 looks north (+z), as in the browser version
	void Apply() => Basis = Basis.FromEuler(new Vector3(_pitch, _yaw + Mathf.Pi, 0), EulerOrder.Yxz);

	public override void _UnhandledInput(InputEvent e)
	{
		if (e is InputEventMouseButton mb && mb.Pressed && mb.ButtonIndex == MouseButton.Left) Input.MouseMode = Input.MouseModeEnum.Captured;
		else if (e is InputEventKey k && k.Pressed && !k.Echo)
		{
			if (k.Keycode == Key.Escape) Input.MouseMode = Input.MouseModeEnum.Visible;
			if (k.Keycode == Key.G) Walking = !Walking;
		}
		else if (e is InputEventMouseMotion mm && Input.MouseMode == Input.MouseModeEnum.Captured)
		{
			_yaw -= mm.Relative.X * MouseSensitivity;
			_pitch = Math.Clamp(_pitch - mm.Relative.Y * MouseSensitivity, -1.5f, 1.5f);
			Apply();
		}
	}

	public override void _Process(double delta)
	{
		if (_gen == null) return;
		var dir = Vector3.Zero;
		if (Input.IsKeyPressed(Key.W)) dir.Z -= 1;
		if (Input.IsKeyPressed(Key.S)) dir.Z += 1;
		if (Input.IsKeyPressed(Key.A)) dir.X -= 1;
		if (Input.IsKeyPressed(Key.D)) dir.X += 1;
		float up = (Input.IsKeyPressed(Key.E) ? 1 : 0) - (Input.IsKeyPressed(Key.Q) ? 1 : 0);
		float speed = Speed * (Input.IsKeyPressed(Key.Shift) ? 6 : 1);
		var move = Basis * dir;
		if (Walking) move = new Vector3(move.X, 0, move.Z);
		if (move.LengthSquared() > 0) move = move.Normalized();
		var p = Position + move * speed * (float)delta;
		if (Walking)
		{
			var (x, z) = WorldOrigin.ToWorld(p);
			float ground = (float)_gen.Height(x, z);
			p.Y = (float.IsNaN(_deck) ? ground : Math.Max(ground, _deck)) + EyeHeight;
		}
		else p.Y += up * speed * (float)delta;
		Position = p;
	}

	public override void _PhysicsProcess(double delta)
	{
		if (_gen == null || !Walking) return;
		var p = Position;
		var (x, z) = WorldOrigin.ToWorld(p);
		float ground = (float)_gen.Height(x, z);
		// a step up from the feet (onto a deck from the road), or from high above just after placing
		float from = _snapFrames > 0 ? ground + 80 : Math.Max(ground, p.Y - EyeHeight) + 0.6f;
		if (_snapFrames > 0) _snapFrames--;
		// (structures only: bridge decks, later floors; not the trees and rocks)
		var q = PhysicsRayQueryParameters3D.Create(new Vector3(p.X, from, p.Z), new Vector3(p.X, ground - 0.05f, p.Z), 1u << 1);
		var hit = GetWorld3D().DirectSpaceState.IntersectRay(q);
		_deck = hit.Count > 0 ? hit["position"].AsVector3().Y : float.NaN;
	}
}
