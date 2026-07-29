// Copyright GrigoriNight. Blueprint-facing data types for GNDPlayFab.
#pragma once

#include "CoreMinimal.h"
#include "GNDPlayFabTypes.generated.h"

/** One purchasable item, merged from PlayFab GetStoreItems + GetCatalogItems (matches the launcher store). */
USTRUCT(BlueprintType)
struct FGNDStoreItem
{
	GENERATED_BODY()

	/** PlayFab catalog item id (the join key between the store and the catalog). */
	UPROPERTY(BlueprintReadOnly, Category = "GND|Store")
	FString ItemId;

	/** Human-readable name from the catalog (empty if the catalog fetch failed). */
	UPROPERTY(BlueprintReadOnly, Category = "GND|Store")
	FString DisplayName;

	/** Catalog description. */
	UPROPERTY(BlueprintReadOnly, Category = "GND|Store")
	FString Description;

	/** Catalog item class / bucket (e.g. "cosmetic", "currency"). */
	UPROPERTY(BlueprintReadOnly, Category = "GND|Store")
	FString ItemClass;

	/** Virtual-currency prices: currency code -> amount, e.g. { "GC": 100, "RM": 499 }. */
	UPROPERTY(BlueprintReadOnly, Category = "GND|Store")
	TMap<FString, int32> Prices;
};

/** Result of a Login attempt. */
USTRUCT(BlueprintType)
struct FGNDLoginResult
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "GND|Auth")
	bool bSuccess = false;

	UPROPERTY(BlueprintReadOnly, Category = "GND|Auth")
	FString PlayFabId;

	/** Session ticket used to authenticate subsequent Client API calls. Empty on failure. */
	UPROPERTY(BlueprintReadOnly, Category = "GND|Auth")
	FString SessionTicket;

	/** Human-readable error message when bSuccess is false. */
	UPROPERTY(BlueprintReadOnly, Category = "GND|Auth")
	FString Error;
};
