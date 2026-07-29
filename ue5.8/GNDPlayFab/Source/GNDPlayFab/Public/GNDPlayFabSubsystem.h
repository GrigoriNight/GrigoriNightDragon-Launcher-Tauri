// Copyright GrigoriNight. PlayFab login/logout/store service for GrigoriNightDragon (UE5.8).
//
// USAGE (C++):
//   UGNDPlayFabSubsystem* PF = GetGameInstance()->GetSubsystem<UGNDPlayFabSubsystem>();
//   PF->OnLogin.AddDynamic(this, &UMyHUD::HandleLogin);
//   PF->Login(TEXT("player@example.com"), TEXT("hunter2"));
//   PF->OnStoreLoaded.AddDynamic(this, &UMyHUD::HandleStore);
//   PF->GetStore();            // fill the shop UI
//   PF->Logout();              // clears the local session
//
// USAGE (Blueprint): "Get Game Instance Subsystem" (class = GND PlayFab Subsystem),
//   bind the OnLogin / OnStoreLoaded / OnLogout events, then call Login / GetStore / Logout.
//
// Endpoints, TitleId, StoreId and CatalogVersion mirror the desktop launcher's PlayFab config.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "Interfaces/IHttpRequest.h"
#include "GNDPlayFabTypes.h"
#include "GNDPlayFabSubsystem.generated.h"

class FJsonObject;

/** Fired when a Login attempt completes (success or failure — check Result.bSuccess). */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FGNDOnLoginResult, const FGNDLoginResult&, Result);

/** Fired when the store finishes loading. On error, Items is empty and Error is set. */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FGNDOnStoreLoaded, const TArray<FGNDStoreItem>&, Items, const FString&, Error);

/** Fired after Logout clears the local session. */
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FGNDOnLogout);

/**
 * Game-instance-wide PlayFab client. Owns the session ticket for the running game and
 * exposes Login / Logout / GetStore to C++ and Blueprint. All calls are async and
 * report back through the multicast delegates below.
 */
UCLASS(Config = Game)
class GNDPLAYFAB_API UGNDPlayFabSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	// ---- Config (overridable in DefaultGame.ini [/Script/GNDPlayFab.GNDPlayFabSubsystem] or at runtime) ----

	/** PlayFab Title ID. The API host is https://<TitleId>.playfabapi.com. */
	UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "GND|Config")
	FString TitleId = TEXT("17CBF3");

	/** Store to read via GetStoreItems. */
	UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "GND|Config")
	FString StoreId = TEXT("01");

	/** Catalog version for GetStoreItems / GetCatalogItems. */
	UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "GND|Config")
	FString CatalogVersion = TEXT("Items_Items");

	// ---- Events ----

	UPROPERTY(BlueprintAssignable, Category = "GND|Auth")
	FGNDOnLoginResult OnLogin;

	UPROPERTY(BlueprintAssignable, Category = "GND|Auth")
	FGNDOnLogout OnLogout;

	UPROPERTY(BlueprintAssignable, Category = "GND|Store")
	FGNDOnStoreLoaded OnStoreLoaded;

	// ---- API ----

	/**
	 * Log in with an email (uses LoginWithEmailAddress) or a username (LoginWithPlayFab).
	 * The path is chosen by whether the identifier contains '@' — same rule as the launcher.
	 * Result is delivered on OnLogin.
	 */
	UFUNCTION(BlueprintCallable, Category = "GND|Auth")
	void Login(const FString& EmailOrUsername, const FString& Password);

	/** Clear the local session. PlayFab client sessions are stateless, so there is no server call. */
	UFUNCTION(BlueprintCallable, Category = "GND|Auth")
	void Logout();

	/** Fetch store items + catalog metadata, merge them, and broadcast OnStoreLoaded. */
	UFUNCTION(BlueprintCallable, Category = "GND|Store")
	void GetStore();

	UFUNCTION(BlueprintPure, Category = "GND|Auth")
	bool IsLoggedIn() const { return !SessionTicket.IsEmpty(); }

	UFUNCTION(BlueprintPure, Category = "GND|Auth")
	FString GetPlayFabId() const { return PlayFabId; }

	UFUNCTION(BlueprintPure, Category = "GND|Auth")
	FString GetSessionTicket() const { return SessionTicket; }

private:
	/** Current session ticket (empty when logged out). */
	FString SessionTicket;

	/** Current PlayFab account id (empty when logged out). */
	FString PlayFabId;

	/** Store items held between the GetStoreItems and GetCatalogItems calls of one GetStore(). */
	TArray<FGNDStoreItem> PendingStore;

	/** https://<TitleId>.playfabapi.com */
	FString BaseUrl() const;

	/** Build a POST to a PlayFab Client endpoint. When bAuthed, attach the X-Authorization ticket. */
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> MakePost(const FString& Path, const TSharedPtr<FJsonObject>& Body, bool bAuthed) const;

	/** Parse the PlayFab {code,status,data} envelope. Returns the data object, or nullptr with OutError set. */
	static TSharedPtr<FJsonObject> ParseEnvelope(FHttpResponsePtr Response, bool bConnected, FString& OutError);

	void HandleLogin(FHttpRequestPtr Request, FHttpResponsePtr Response, bool bConnected);
	void HandleStoreItems(FHttpRequestPtr Request, FHttpResponsePtr Response, bool bConnected);
	void HandleCatalog(FHttpRequestPtr Request, FHttpResponsePtr Response, bool bConnected);
};
