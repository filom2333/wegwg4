using System;
using Godot;

namespace DustRoad.World;

// The road runs 150 km north, further than single-precision positions keep centimetres. Scene
// positions are therefore relative to a floating origin (in world metres) that follows the player:
// world = scene + Origin. Whatever holds world things moves them when the origin moves.
public static class WorldOrigin
{
	public static double X { get; private set; }
	public static double Z { get; private set; }

	// (dx, dz): how far the origin moved; scene positions must move by minus that
	public static event Action<double, double> Shifted;

	public static Vector3 ToScene(double x, double y, double z) => new((float)(x - X), (float)y, (float)(z - Z));
	public static (double x, double z) ToWorld(Vector3 p) => (p.X + X, p.Z + Z);

	// Moves the origin to the given world point (rounded to whole metres).
	public static void MoveTo(double x, double z)
	{
		double nx = Math.Round(x), nz = Math.Round(z);
		double dx = nx - X, dz = nz - Z;
		if (dx == 0 && dz == 0) return;
		X = nx;
		Z = nz;
		Shifted?.Invoke(dx, dz);
	}

	public static void Reset()
	{
		X = 0;
		Z = 0;
	}
}
