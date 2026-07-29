// Copyright GrigoriNight. Build rules for the GNDPlayFab runtime module (UE5.8).
using UnrealBuildTool;

public class GNDPlayFab : ModuleRules
{
	public GNDPlayFab(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = ModuleRules.PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine"
		});

		// HTTP + JSON power the PlayFab REST calls (login / logout / store).
		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"HTTP",
			"Json",
			"JsonUtilities"
		});
	}
}
