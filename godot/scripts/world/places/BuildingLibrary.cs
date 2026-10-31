using System.Collections.Generic;
using System.Text.Json;
using Godot;

namespace DustRoad.World.Places;

// The buildings modelled in Blender (tools/blender/buildings.py): assets/models/buildings/
// <name>.glb and what the game needs to know about each, <name>.json (colliders, door leaves,
// lights, rooms). Models load in the background; an instance gets the game's materials for its
// tokens, its weathering and snow, and its doors set shut or open.
public static class BuildingLibrary
{
	public const string Dir = "res://assets/models/buildings/";

	public sealed class Box
	{
		public Vector3 C, H;
		public float RotY, RotX;
		public string Surface;
	}

	public sealed class DoorInfo
	{
		public string Name;
		public Vector3 Hinge;
		public float Rot, W, H, T, Open;
		public bool Ext;
	}

	public sealed class Meta
	{
		public string Name;
		public float FloorY;
		public Vector2 Footprint;
		public readonly List<Box> Colliders = new();
		public readonly List<DoorInfo> Doors = new();
		public readonly List<(Vector3 pos, string kind)> Lights = new();
		public Vector2? CarSpot;
	}

	static readonly Dictionary<string, Meta> Metas = new();
	static readonly object MetaLock = new();

	static Vector3 V3(JsonElement a) => new(a[0].GetSingle(), a[1].GetSingle(), a[2].GetSingle());

	// What is known about a building (any thread).
	public static Meta GetMeta(string name)
	{
		lock (MetaLock)
		{
			if (Metas.TryGetValue(name, out var m)) return m;
			m = new Meta { Name = name };
			string path = Dir + name + ".json";
			if (FileAccess.FileExists(path))
			{
				var root = JsonDocument.Parse(FileAccess.GetFileAsString(path)).RootElement;
				m.FloorY = root.GetProperty("floor_y").GetSingle();
				var fp = root.GetProperty("footprint");
				m.Footprint = new Vector2(fp[0].GetSingle(), fp[1].GetSingle());
				foreach (var c in root.GetProperty("colliders").EnumerateArray())
					m.Colliders.Add(new Box { C = V3(c.GetProperty("c")), H = V3(c.GetProperty("h")), RotY = c.GetProperty("ry").GetSingle(), RotX = c.GetProperty("rx").GetSingle(), Surface = c.GetProperty("s").GetString() });
				foreach (var d in root.GetProperty("doors").EnumerateArray())
					m.Doors.Add(new DoorInfo
					{
						Name = d.GetProperty("name").GetString(),
						Hinge = V3(d.GetProperty("hinge")),
						Rot = d.GetProperty("rot").GetSingle(),
						W = d.GetProperty("w").GetSingle(),
						H = d.GetProperty("h").GetSingle(),
						T = d.GetProperty("t").GetSingle(),
						Open = d.GetProperty("open").GetSingle(),
						Ext = d.GetProperty("ext").GetBoolean(),
					});
				foreach (var l in root.GetProperty("lights").EnumerateArray())
					m.Lights.Add((V3(l.GetProperty("pos")), l.GetProperty("kind").GetString()));
				if (root.TryGetProperty("car_spot", out var cs) && cs.ValueKind == JsonValueKind.Array)
					m.CarSpot = new Vector2(cs[0].GetSingle(), cs[1].GetSingle());
			}
			else GD.PushError($"building '{name}' has no {path}");
			Metas[name] = m;
			return m;
		}
	}

	static string Path(string name) => Dir + name + ".glb";

	// Start loading a model in the background (main thread).
	public static void Request(string name)
	{
		string p = Path(name);
		if (ResourceLoader.HasCached(p)) return;
		if (ResourceLoader.LoadThreadedGetStatus(p) == ResourceLoader.ThreadLoadStatus.InvalidResource) ResourceLoader.LoadThreadedRequest(p);
	}

	public static bool IsReady(string name)
	{
		string p = Path(name);
		return ResourceLoader.HasCached(p) || ResourceLoader.LoadThreadedGetStatus(p) is ResourceLoader.ThreadLoadStatus.Loaded or ResourceLoader.ThreadLoadStatus.Failed;
	}

	// The building as a node tree, dressed: the game's materials on its tokens, `age` (0 kept,
	// 1 derelict) and `snow` for the weathering, glass casting no shadow, doors shut or open as
	// they were left (main thread).
	public static Node3D Instantiate(string name, float age, float snow)
	{
		string p = Path(name);
		// (loaded in the background if it was asked for, else here and now)
		var scene = !ResourceLoader.HasCached(p) && ResourceLoader.LoadThreadedGetStatus(p) == ResourceLoader.ThreadLoadStatus.Loaded
			? ResourceLoader.LoadThreadedGet(p) as PackedScene
			: ResourceLoader.Load<PackedScene>(p);
		if (scene == null)
		{
			GD.PushError($"building model {p} missing");
			return new Node3D { Name = name };
		}
		var root = scene.Instantiate<Node3D>();
		root.Name = name;
		Dress(root, age, snow);
		var meta = GetMeta(name);
		foreach (var d in meta.Doors)
		{
			var leaf = root.GetNodeOrNull<Node3D>(d.Name);
			if (leaf == null) continue;
			float open = d.Open > 0.3f ? 1 : 0;
			leaf.Rotation = new Vector3(0, d.Rot + open * 1.55f, 0);
			var body = new StaticBody3D { Name = "Leaf", CollisionLayer = PlaceStreamer.StructureLayer, CollisionMask = 0 };
			body.AddChild(new CollisionShape3D { Shape = new BoxShape3D { Size = new Vector3(d.W, d.H, d.T) }, Position = new Vector3(d.W / 2, d.H / 2, 0) });
			leaf.AddChild(body);
		}
		return root;
	}

	static void Dress(Node n, float age, float snow)
	{
		if (n is MeshInstance3D mi && mi.Mesh != null)
		{
			bool clear = false;
			for (int i = 0; i < mi.Mesh.GetSurfaceCount(); i++)
			{
				string token = mi.Mesh.SurfaceGetMaterial(i)?.ResourceName ?? "";
				int dot = token.IndexOf('.');
				if (dot > 0) token = token[..dot];
				if (token.Length == 0) continue;
				mi.SetSurfaceOverrideMaterial(i, BuildingMaterials.Get(token));
				clear |= BuildingMaterials.IsClear(token);
			}
			if (clear) mi.CastShadow = GeometryInstance3D.ShadowCastingSetting.Off;
			mi.SetInstanceShaderParameter("age", age);
			mi.SetInstanceShaderParameter("snow", snow);
		}
		foreach (var c in n.GetChildren()) Dress(c, age, snow);
	}
}
