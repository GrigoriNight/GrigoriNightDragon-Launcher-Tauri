// Copyright GrigoriNight. See GNDPlayFabSubsystem.h for usage.
#include "GNDPlayFabSubsystem.h"

#include "HttpModule.h"
#include "Interfaces/IHttpResponse.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

FString UGNDPlayFabSubsystem::BaseUrl() const
{
	return FString::Printf(TEXT("https://%s.playfabapi.com"), *TitleId);
}

TSharedRef<IHttpRequest, ESPMode::ThreadSafe> UGNDPlayFabSubsystem::MakePost(const FString& Path, const TSharedPtr<FJsonObject>& Body, bool bAuthed) const
{
	FString BodyStr;
	if (Body.IsValid())
	{
		TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&BodyStr);
		FJsonSerializer::Serialize(Body.ToSharedRef(), Writer);
	}

	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Req = FHttpModule::Get().CreateRequest();
	Req->SetURL(BaseUrl() + Path);
	Req->SetVerb(TEXT("POST"));
	Req->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Req->SetHeader(TEXT("Accept"), TEXT("application/json"));
	if (bAuthed && !SessionTicket.IsEmpty())
	{
		// PlayFab authenticates Client API calls with the session ticket in this header.
		Req->SetHeader(TEXT("X-Authorization"), SessionTicket);
	}
	Req->SetContentAsString(BodyStr);
	return Req;
}

TSharedPtr<FJsonObject> UGNDPlayFabSubsystem::ParseEnvelope(FHttpResponsePtr Response, bool bConnected, FString& OutError)
{
	if (!bConnected || !Response.IsValid())
	{
		OutError = TEXT("Couldn't reach PlayFab - check your connection.");
		return nullptr;
	}

	TSharedPtr<FJsonObject> Root;
	const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Response->GetContentAsString());
	if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid())
	{
		OutError = FString::Printf(TEXT("Bad response (HTTP %d)."), Response->GetResponseCode());
		return nullptr;
	}

	double CodeNum = 0.0;
	const int32 Code = Root->TryGetNumberField(TEXT("code"), CodeNum) ? (int32)CodeNum : Response->GetResponseCode();
	if (Code != 200)
	{
		FString Msg;
		if (Root->TryGetStringField(TEXT("errorMessage"), Msg) && !Msg.IsEmpty())
		{
			OutError = Msg;
		}
		else if (Root->TryGetStringField(TEXT("error"), Msg) && !Msg.IsEmpty())
		{
			OutError = Msg;
		}
		else
		{
			OutError = FString::Printf(TEXT("PlayFab error (HTTP %d)."), Code);
		}
		return nullptr;
	}

	const TSharedPtr<FJsonObject>* DataPtr = nullptr;
	if (!Root->TryGetObjectField(TEXT("data"), DataPtr) || !DataPtr)
	{
		OutError = TEXT("Response had no 'data'.");
		return nullptr;
	}
	return *DataPtr;
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
void UGNDPlayFabSubsystem::Login(const FString& EmailOrUsername, const FString& Password)
{
	const bool bEmail = EmailOrUsername.Contains(TEXT("@"));
	const FString Path = bEmail ? TEXT("/Client/LoginWithEmailAddress") : TEXT("/Client/LoginWithPlayFab");

	const TSharedPtr<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetStringField(TEXT("TitleId"), TitleId);
	if (bEmail)
	{
		Body->SetStringField(TEXT("Email"), EmailOrUsername);
	}
	else
	{
		Body->SetStringField(TEXT("Username"), EmailOrUsername);
	}
	Body->SetStringField(TEXT("Password"), Password);

	const TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Req = MakePost(Path, Body, /*bAuthed*/ false);
	Req->OnProcessRequestComplete().BindUObject(this, &UGNDPlayFabSubsystem::HandleLogin);
	Req->ProcessRequest();
}

void UGNDPlayFabSubsystem::HandleLogin(FHttpRequestPtr Request, FHttpResponsePtr Response, bool bConnected)
{
	FGNDLoginResult Result;
	FString Error;
	const TSharedPtr<FJsonObject> Data = ParseEnvelope(Response, bConnected, Error);
	if (!Data.IsValid())
	{
		Result.bSuccess = false;
		Result.Error = Error;
		OnLogin.Broadcast(Result);
		return;
	}

	Data->TryGetStringField(TEXT("PlayFabId"), Result.PlayFabId);
	Data->TryGetStringField(TEXT("SessionTicket"), Result.SessionTicket);
	Result.bSuccess = !Result.SessionTicket.IsEmpty();

	if (Result.bSuccess)
	{
		SessionTicket = Result.SessionTicket;
		PlayFabId = Result.PlayFabId;
	}
	else if (Result.Error.IsEmpty())
	{
		Result.Error = TEXT("Login failed.");
	}

	OnLogin.Broadcast(Result);
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------
void UGNDPlayFabSubsystem::Logout()
{
	SessionTicket.Reset();
	PlayFabId.Reset();
	OnLogout.Broadcast();
}

// ---------------------------------------------------------------------------
// Store: GetStoreItems -> GetCatalogItems -> merge -> broadcast
// ---------------------------------------------------------------------------
void UGNDPlayFabSubsystem::GetStore()
{
	PendingStore.Reset();

	const TSharedPtr<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetStringField(TEXT("StoreId"), StoreId);
	Body->SetStringField(TEXT("CatalogVersion"), CatalogVersion);

	const TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Req = MakePost(TEXT("/Client/GetStoreItems"), Body, /*bAuthed*/ IsLoggedIn());
	Req->OnProcessRequestComplete().BindUObject(this, &UGNDPlayFabSubsystem::HandleStoreItems);
	Req->ProcessRequest();
}

void UGNDPlayFabSubsystem::HandleStoreItems(FHttpRequestPtr Request, FHttpResponsePtr Response, bool bConnected)
{
	FString Error;
	const TSharedPtr<FJsonObject> Data = ParseEnvelope(Response, bConnected, Error);
	if (!Data.IsValid())
	{
		OnStoreLoaded.Broadcast(TArray<FGNDStoreItem>(), Error);
		return;
	}

	const TArray<TSharedPtr<FJsonValue>>* Store = nullptr;
	if (Data->TryGetArrayField(TEXT("Store"), Store) && Store)
	{
		for (const TSharedPtr<FJsonValue>& Value : *Store)
		{
			const TSharedPtr<FJsonObject> Obj = Value.IsValid() ? Value->AsObject() : nullptr;
			if (!Obj.IsValid())
			{
				continue;
			}

			FGNDStoreItem Item;
			Obj->TryGetStringField(TEXT("ItemId"), Item.ItemId);

			const TSharedPtr<FJsonObject>* Prices = nullptr;
			if (Obj->TryGetObjectField(TEXT("VirtualCurrencyPrices"), Prices) && Prices)
			{
				for (const TPair<FString, TSharedPtr<FJsonValue>>& Pair : (*Prices)->Values)
				{
					double Amount = 0.0;
					if (Pair.Value.IsValid() && Pair.Value->TryGetNumber(Amount))
					{
						Item.Prices.Add(Pair.Key, (int32)Amount);
					}
				}
			}

			PendingStore.Add(MoveTemp(Item));
		}
	}

	// Enrich with catalog display names / descriptions, then broadcast in HandleCatalog.
	const TSharedPtr<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetStringField(TEXT("CatalogVersion"), CatalogVersion);

	const TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Req = MakePost(TEXT("/Client/GetCatalogItems"), Body, /*bAuthed*/ IsLoggedIn());
	Req->OnProcessRequestComplete().BindUObject(this, &UGNDPlayFabSubsystem::HandleCatalog);
	Req->ProcessRequest();
}

void UGNDPlayFabSubsystem::HandleCatalog(FHttpRequestPtr Request, FHttpResponsePtr Response, bool bConnected)
{
	FString Error;
	const TSharedPtr<FJsonObject> Data = ParseEnvelope(Response, bConnected, Error);

	// The catalog is optional enrichment: if it fails we still return the store items we already have.
	if (Data.IsValid())
	{
		const TArray<TSharedPtr<FJsonValue>>* Catalog = nullptr;
		if (Data->TryGetArrayField(TEXT("Catalog"), Catalog) && Catalog)
		{
			TMap<FString, TSharedPtr<FJsonObject>> ById;
			for (const TSharedPtr<FJsonValue>& Value : *Catalog)
			{
				const TSharedPtr<FJsonObject> Obj = Value.IsValid() ? Value->AsObject() : nullptr;
				FString Id;
				if (Obj.IsValid() && Obj->TryGetStringField(TEXT("ItemId"), Id))
				{
					ById.Add(Id, Obj);
				}
			}

			for (FGNDStoreItem& Item : PendingStore)
			{
				if (const TSharedPtr<FJsonObject>* Found = ById.Find(Item.ItemId))
				{
					(*Found)->TryGetStringField(TEXT("DisplayName"), Item.DisplayName);
					(*Found)->TryGetStringField(TEXT("Description"), Item.Description);
					(*Found)->TryGetStringField(TEXT("ItemClass"), Item.ItemClass);
				}
			}
		}
	}

	OnStoreLoaded.Broadcast(PendingStore, Data.IsValid() ? FString() : Error);
	PendingStore.Reset();
}
