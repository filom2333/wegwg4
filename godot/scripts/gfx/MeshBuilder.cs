using System;
using System.Collections.Generic;
using Godot;

namespace DustRoad.Gfx;

// Builds a mesh out of pieces (boxes, cylinders, lofted sections, tubes, quads) for the
// procedural structures: bridges now, buildings later. Plain lists, so it can run on a worker
// thread; ToMesh() on the main thread. Faces are wound clockwise seen from outside (Godot's front).
public sealed class MeshBuilder
{
	public readonly List<Vector3> Pos = new();
	public readonly List<Vector3> Nrm = new();
	public readonly List<Vector2> Uv = new();
	// optional second UVs: filled by the caller, one per vertex, after adding a piece
	public readonly List<Vector2> Uv2 = new();
	public readonly List<int> Idx = new();

	public int VertexCount => Pos.Count;

	int Vert(Vector3 p, Vector3 n, Vector2 uv)
	{
		Pos.Add(p);
		Nrm.Add(n);
		Uv.Add(uv);
		return Pos.Count - 1;
	}

	// A triangle facing `outward` (its winding is set from that).
	public void Tri(int a, int b, int c, Vector3 outward)
	{
		var n = (Pos[b] - Pos[a]).Cross(Pos[c] - Pos[a]);
		if (n.Dot(outward) > 0) (b, c) = (c, b);
		Idx.Add(a);
		Idx.Add(b);
		Idx.Add(c);
	}

	// A flat quad p0 p1 p2 p3 (in order round its edge) facing `outward`, with its own vertices.
	public void Quad(Vector3 p0, Vector3 p1, Vector3 p2, Vector3 p3, Vector3 outward, float uvScale = 1)
	{
		var n = (p1 - p0).Cross(p3 - p0).Normalized();
		if (n.Dot(outward) < 0) n = -n;
		float w = p0.DistanceTo(p1) * uvScale, h = p0.DistanceTo(p3) * uvScale;
		int a = Vert(p0, n, new Vector2(0, 0)), b = Vert(p1, n, new Vector2(w, 0)), c = Vert(p2, n, new Vector2(w, h)), d = Vert(p3, n, new Vector2(0, h));
		Tri(a, b, c, n);
		Tri(a, c, d, n);
	}

	// A primitive mesh (BoxMesh, CylinderMesh...) placed by `xf`. Main thread only (Godot meshes).
	public void Add(PrimitiveMesh prim, Transform3D xf)
	{
		var arr = prim.GetMeshArrays();
		var p = arr[(int)Mesh.ArrayType.Vertex].AsVector3Array();
		var n = arr[(int)Mesh.ArrayType.Normal].AsVector3Array();
		var uvs = arr[(int)Mesh.ArrayType.TexUV].AsVector2Array();
		var idx = arr[(int)Mesh.ArrayType.Index].AsInt32Array();
		int base0 = Pos.Count;
		for (int i = 0; i < p.Length; i++) Vert(xf * p[i], (xf.Basis * n[i]).Normalized(), uvs.Length > i ? uvs[i] : Vector2.Zero);
		foreach (int i in idx) Idx.Add(base0 + i);
	}

	// An axis-aligned box (in the frame `xf`) of half extents `h`, without Godot meshes (any thread).
	public void Box(Transform3D xf, Vector3 h, float uvScale = 1)
	{
		Vector3 C(float x, float y, float z) => xf * new Vector3(x * h.X, y * h.Y, z * h.Z);
		var o = xf.Origin;
		void F(Vector3 a, Vector3 b, Vector3 c, Vector3 d)
		{
			var mid = (a + b + c + d) / 4;
			Quad(a, b, c, d, mid - o, uvScale);
		}
		F(C(-1, -1, 1), C(1, -1, 1), C(1, 1, 1), C(-1, 1, 1));
		F(C(1, -1, -1), C(-1, -1, -1), C(-1, 1, -1), C(1, 1, -1));
		F(C(-1, 1, -1), C(-1, 1, 1), C(1, 1, 1), C(1, 1, -1));
		F(C(-1, -1, 1), C(-1, -1, -1), C(1, -1, -1), C(1, -1, 1));
		F(C(1, -1, 1), C(1, -1, -1), C(1, 1, -1), C(1, 1, 1));
		F(C(-1, -1, -1), C(-1, -1, 1), C(-1, 1, 1), C(-1, 1, -1));
	}

	// A tapered cylinder from `a` to `b` (radii ra, rb), capped (any thread).
	public void Cylinder(Vector3 a, Vector3 b, float ra, float rb, int seg = 12, bool caps = true)
	{
		var axis = (b - a).Normalized();
		var u = Math.Abs(axis.Y) < 0.9f ? axis.Cross(Vector3.Up).Normalized() : axis.Cross(Vector3.Right).Normalized();
		var v = axis.Cross(u);
		float len = a.DistanceTo(b);
		int start = Pos.Count;
		for (int i = 0; i <= seg; i++)
		{
			float t = i / (float)seg * Mathf.Tau;
			var dir = u * Mathf.Cos(t) + v * Mathf.Sin(t);
			// the side normal leans with the taper
			var n = (dir + axis * ((ra - rb) / Math.Max(len, 1e-4f))).Normalized();
			Vert(a + dir * ra, n, new Vector2(i / (float)seg * Mathf.Tau * (ra + rb) * 0.5f, 0));
			Vert(b + dir * rb, n, new Vector2(i / (float)seg * Mathf.Tau * (ra + rb) * 0.5f, len));
		}
		for (int i = 0; i < seg; i++)
		{
			int p0 = start + i * 2, p1 = p0 + 1, p2 = p0 + 2, p3 = p0 + 3;
			var outward = Nrm[p0] + Nrm[p2];
			Tri(p0, p2, p1, outward);
			Tri(p1, p2, p3, outward);
		}
		if (!caps) return;
		foreach (var (c, r, n) in new[] { (a, ra, -axis), (b, rb, axis) })
		{
			int ci = Vert(c, n, Vector2.Zero);
			int r0 = Pos.Count;
			for (int i = 0; i <= seg; i++)
			{
				float t = i / (float)seg * Mathf.Tau;
				var dir = u * Mathf.Cos(t) + v * Mathf.Sin(t);
				Vert(c + dir * r, n, new Vector2(dir.Dot(u), dir.Dot(v)) * r);
			}
			for (int i = 0; i < seg; i++) Tri(ci, r0 + i, r0 + i + 1, n);
		}
	}

	// A round tube of radius r along a polyline (no caps; the ends are hidden in posts or walls).
	public void Tube(IReadOnlyList<Vector3> pts, float r, int radial = 8)
	{
		if (pts.Count < 2) return;
		int start = Pos.Count;
		var prevU = Vector3.Zero;
		float along = 0;
		for (int i = 0; i < pts.Count; i++)
		{
			var t = (i == 0 ? pts[1] - pts[0] : i == pts.Count - 1 ? pts[i] - pts[i - 1] : pts[i + 1] - pts[i - 1]).Normalized();
			// carry the ring's orientation along without twisting
			var u = i == 0 ? (Math.Abs(t.Y) < 0.9f ? t.Cross(Vector3.Up) : t.Cross(Vector3.Right)).Normalized() : (prevU - t * prevU.Dot(t)).Normalized();
			prevU = u;
			var v = t.Cross(u);
			if (i > 0) along += pts[i].DistanceTo(pts[i - 1]);
			for (int k = 0; k <= radial; k++)
			{
				float a = k / (float)radial * Mathf.Tau;
				var dir = u * Mathf.Cos(a) + v * Mathf.Sin(a);
				Vert(pts[i] + dir * r, dir, new Vector2(k / (float)radial, along));
			}
		}
		int ring = radial + 1;
		for (int i = 0; i < pts.Count - 1; i++)
			for (int k = 0; k < radial; k++)
			{
				int p0 = start + i * ring + k, p1 = p0 + 1, p2 = p0 + ring, p3 = p2 + 1;
				var outward = Nrm[p0] + Nrm[p1];
				Tri(p0, p1, p2, outward);
				Tri(p1, p3, p2, outward);
			}
	}

	// A straight beam of rectangular section from `a` to `b`: `w` wide across `side` and `h` deep
	// across the other way, ends capped (any thread).
	public void Beam(Vector3 a, Vector3 b, Vector3 side, float w, float h, float uvScale = 1)
	{
		var t = b - a;
		float len = t.Length();
		if (len < 1e-4f) return;
		t /= len;
		var u = (side - t * side.Dot(t)).Normalized();
		var v = t.Cross(u);
		Box(new Transform3D(new Basis(u, v, t), (a + b) / 2), new Vector3(w / 2, h / 2, len / 2), uvScale);
	}

	// A rectangular section lofted along a centre line: `side` vectors give the across direction at
	// each point; the section spans a0..a1 across and y0..y1 up. Hard edges, capped ends.
	public void LoftRect(IReadOnlyList<Vector3> c, IReadOnlyList<Vector3> side, float a0, float a1, float y0, float y1)
	{
		var up = Vector3.Up;
		Vector3 P(int i, float a, float y) => c[i] + side[i] * a + up * y;
		float along = 0;
		for (int i = 0; i < c.Count - 1; i++)
		{
			float l = c[i].DistanceTo(c[i + 1]);
			var mid = (c[i] + c[i + 1]) / 2 + up * ((y0 + y1) / 2) + (side[i] + side[i + 1]) / 2 * ((a0 + a1) / 2);
			void F(Vector3 p0, Vector3 p1, Vector3 p2, Vector3 p3)
			{
				var m = (p0 + p1 + p2 + p3) / 4;
				Quad(p0, p1, p2, p3, m - mid);
			}
			F(P(i, a0, y1), P(i, a1, y1), P(i + 1, a1, y1), P(i + 1, a0, y1)); // top
			F(P(i, a0, y0), P(i + 1, a0, y0), P(i + 1, a1, y0), P(i, a1, y0)); // bottom
			F(P(i, a0, y0), P(i, a0, y1), P(i + 1, a0, y1), P(i + 1, a0, y0)); // side a0
			F(P(i, a1, y0), P(i + 1, a1, y0), P(i + 1, a1, y1), P(i, a1, y1)); // side a1
			along += l;
		}
		int n = c.Count - 1;
		var d0 = (c[0] - c[1]).Normalized();
		Quad(P(0, a0, y0), P(0, a1, y0), P(0, a1, y1), P(0, a0, y1), d0);
		var d1 = (c[n] - c[n - 1]).Normalized();
		Quad(P(n, a0, y0), P(n, a1, y0), P(n, a1, y1), P(n, a0, y1), d1);
	}

	public ArrayMesh ToMesh(ArrayMesh into = null)
	{
		var mesh = into ?? new ArrayMesh();
		if (Idx.Count == 0) return mesh;
		var arrays = new Godot.Collections.Array();
		arrays.Resize((int)Mesh.ArrayType.Max);
		arrays[(int)Mesh.ArrayType.Vertex] = Pos.ToArray();
		arrays[(int)Mesh.ArrayType.Normal] = Nrm.ToArray();
		arrays[(int)Mesh.ArrayType.TexUV] = Uv.ToArray();
		if (Uv2.Count == Pos.Count) arrays[(int)Mesh.ArrayType.TexUV2] = Uv2.ToArray();
		arrays[(int)Mesh.ArrayType.Index] = Idx.ToArray();
		mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays);
		return mesh;
	}
}
