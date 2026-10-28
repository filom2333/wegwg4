using System;

namespace DustRoad.Core;

// Seeded random numbers and gradient noise used by every procedural system. A bit-for-bit port of
// web/src/core/noise.js: the same seed gives the same numbers, so the world matches the browser
// version. Integer steps use uint arithmetic (JS's Math.imul and >>> wrap the same way).
public static class Hash
{
	public static Func<double> Mulberry32(uint seed)
	{
		uint a = seed;
		return () =>
		{
			a += 0x6d2b79f5;
			uint t = a;
			t = (t ^ (t >> 15)) * (t | 1);
			t ^= t + (t ^ (t >> 7)) * (t | 61);
			return (t ^ (t >> 14)) / 4294967296.0;
		};
	}

	public static uint Ints(int a, int b, int c)
	{
		uint h = 2166136261;
		h = Step(h, a);
		h = Step(h, b);
		h = Step(h, c);
		return h;
	}

	public static uint Ints(int a, int b, int c, int d) => Step(Ints(a, b, c), d);

	static uint Step(uint h, int v)
	{
		h ^= (uint)v;
		h *= 16777619;
		h ^= h >> 13;
		h *= 0x5bd1e995;
		h ^= h >> 15;
		return h;
	}

	public static double H01(int a, int b, int c) => Ints(a, b, c) / 4294967296.0;
	public static double H01(int a, int b, int c, int d) => Ints(a, b, c, d) / 4294967296.0;
}

public sealed class Rng
{
	readonly Func<double> _next;

	public Rng(uint seed) => _next = Hash.Mulberry32(seed);

	public double Next() => _next();
	public double Float(double a = 0, double b = 1) => a + (b - a) * _next();
	public int Int(int a, int b) => (int)Math.Floor(Float(a, b + 1));
	public bool Chance(double p) => _next() < p;
	public int Sign() => _next() < 0.5 ? -1 : 1;
	public T Pick<T>(T[] arr) => arr[(int)Math.Floor(_next() * arr.Length) % arr.Length];
}

// Simplex noise (Stefan Gustavson's reference implementation, seeded permutation).
public sealed class SimplexNoise
{
	static readonly double[] Grad3 = { 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1 };
	static readonly double F2 = 0.5 * (Math.Sqrt(3) - 1), G2 = (3 - Math.Sqrt(3)) / 6;
	const double F3 = 1.0 / 3, G3 = 1.0 / 6;

	readonly byte[] _perm = new byte[512];
	readonly byte[] _permMod12 = new byte[512];

	public SimplexNoise(double seed)
	{
		var rnd = Hash.Mulberry32(MathX.ToUint32(seed));
		var p = new byte[256];
		for (int i = 0; i < 256; i++) p[i] = (byte)i;
		for (int i = 255; i > 0; i--)
		{
			int j = (int)Math.Floor(rnd() * (i + 1));
			(p[i], p[j]) = (p[j], p[i]);
		}
		for (int i = 0; i < 512; i++)
		{
			_perm[i] = p[i & 255];
			_permMod12[i] = (byte)(_perm[i] % 12);
		}
	}

	public double Noise2(double xin, double yin)
	{
		var perm = _perm;
		var pm = _permMod12;
		double n0 = 0, n1 = 0, n2 = 0;
		double s = (xin + yin) * F2;
		double fi = Math.Floor(xin + s), fj = Math.Floor(yin + s);
		double t = (fi + fj) * G2;
		double x0 = xin - (fi - t), y0 = yin - (fj - t);
		int i1, j1;
		if (x0 > y0) { i1 = 1; j1 = 0; }
		else { i1 = 0; j1 = 1; }
		double x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
		double x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
		int ii = (int)(long)fi & 255, jj = (int)(long)fj & 255;
		double t0 = 0.5 - x0 * x0 - y0 * y0;
		if (t0 >= 0)
		{
			int gi = pm[ii + perm[jj]] * 3;
			t0 *= t0;
			n0 = t0 * t0 * (Grad3[gi] * x0 + Grad3[gi + 1] * y0);
		}
		double t1 = 0.5 - x1 * x1 - y1 * y1;
		if (t1 >= 0)
		{
			int gi = pm[ii + i1 + perm[jj + j1]] * 3;
			t1 *= t1;
			n1 = t1 * t1 * (Grad3[gi] * x1 + Grad3[gi + 1] * y1);
		}
		double t2 = 0.5 - x2 * x2 - y2 * y2;
		if (t2 >= 0)
		{
			int gi = pm[ii + 1 + perm[jj + 1]] * 3;
			t2 *= t2;
			n2 = t2 * t2 * (Grad3[gi] * x2 + Grad3[gi + 1] * y2);
		}
		return 70 * (n0 + n1 + n2);
	}

	public double Noise3(double xin, double yin, double zin)
	{
		var perm = _perm;
		var pm = _permMod12;
		double n0, n1, n2, n3;
		double s = (xin + yin + zin) * F3;
		double fi = Math.Floor(xin + s), fj = Math.Floor(yin + s), fk = Math.Floor(zin + s);
		double t = (fi + fj + fk) * G3;
		double x0 = xin - (fi - t), y0 = yin - (fj - t), z0 = zin - (fk - t);
		int i1, j1, k1, i2, j2, k2;
		if (x0 >= y0)
		{
			if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
			else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
			else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
		}
		else
		{
			if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
			else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
			else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
		}
		double x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
		double x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
		double x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
		int ii = (int)(long)fi & 255, jj = (int)(long)fj & 255, kk = (int)(long)fk & 255;
		double t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
		if (t0 < 0) n0 = 0;
		else
		{
			int gi = pm[ii + perm[jj + perm[kk]]] * 3;
			t0 *= t0;
			n0 = t0 * t0 * (Grad3[gi] * x0 + Grad3[gi + 1] * y0 + Grad3[gi + 2] * z0);
		}
		double t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
		if (t1 < 0) n1 = 0;
		else
		{
			int gi = pm[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3;
			t1 *= t1;
			n1 = t1 * t1 * (Grad3[gi] * x1 + Grad3[gi + 1] * y1 + Grad3[gi + 2] * z1);
		}
		double t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
		if (t2 < 0) n2 = 0;
		else
		{
			int gi = pm[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3;
			t2 *= t2;
			n2 = t2 * t2 * (Grad3[gi] * x2 + Grad3[gi + 1] * y2 + Grad3[gi + 2] * z2);
		}
		double t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
		if (t3 < 0) n3 = 0;
		else
		{
			int gi = pm[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3;
			t3 *= t3;
			n3 = t3 * t3 * (Grad3[gi] * x3 + Grad3[gi + 1] * y3 + Grad3[gi + 2] * z3);
		}
		return 32 * (n0 + n1 + n2 + n3);
	}

	public double Fbm2(double x, double y, int octaves = 4, double lac = 2, double gain = 0.5)
	{
		double a = 1, f = 1, s = 0, n = 0;
		for (int i = 0; i < octaves; i++)
		{
			s += a * Noise2(x * f, y * f);
			n += a;
			a *= gain;
			f *= lac;
		}
		return s / n;
	}

	public double Ridged2(double x, double y, int octaves = 4)
	{
		double a = 1, f = 1, s = 0, n = 0;
		for (int i = 0; i < octaves; i++)
		{
			s += a * (1 - Math.Abs(Noise2(x * f, y * f)));
			n += a;
			a *= 0.5;
			f *= 2.03;
		}
		return s / n;
	}
}

public static class MathX
{
	public static double Clamp(double v, double a, double b) => v < a ? a : v > b ? b : v;
	public static double Lerp(double a, double b, double t) => a + (b - a) * t;

	public static double Smoothstep(double a, double b, double x)
	{
		double t = Clamp((x - a) / (b - a), 0, 1);
		return t * t * (3 - 2 * t);
	}

	// JavaScript's Math.round (halves round up, toward +infinity)
	public static double JsRound(double x) => Math.Floor(x + 0.5);

	// JavaScript's ToUint32 / ToInt32 (x >>> 0, x | 0) for the integer-valued numbers used here
	public static uint ToUint32(double x) => unchecked((uint)(long)x);
	public static int ToInt32(double x) => unchecked((int)(long)x);
}
