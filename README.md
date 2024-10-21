# [ErmisChat](https://ermis.network) Chat SDK for JavaScript

![Platform](https://img.shields.io/badge/platform-JAVASCRIPT-orange.svg)
![Languages](https://img.shields.io/badge/language-TYPESCRIPT-orange.svg)
[![npm](https://img.shields.io/npm/v/ermis-chat-js-sdk.svg?style=popout&colorB=red)](https://www.npmjs.com/package/ermis-chat-js-sdk)

## Table of contents

1.  [Introduction](#introduction)
1.  [Requirements](#requirements)
1.  [Getting Started](#getting-started)
1.  [Features](#features)
1.  [Error codes](#error-codes)

## Introduction

The ErmisChat SDK for JavaScript allows you to integrate real-time chat into your client app with minimal effort.

## Requirements

This section shows you the prerequisites needed to use the ErmisChat SDK for JavaScript. If you have any comments or questions regarding bugs and feature requests, please reach out to us.

## Supported browsers

|      Browser      | Supported versions     |
| :---------------: | :--------------------- |
| Internet Explorer | Not supported          |
|       Edge        | 13 or higher           |
|      Chrome       | 16 or higher           |
|      Firefox      | 11 or higher           |
|      Safari       | 7 or higher            |
|       Opera       | 12.1 or higher         |
|    iOS Safari     | 7 or higher            |
|  Android Browser  | 4.4 (Kitkat) or higher |

<br />

## Getting started

The ErmisChat client is designed to allow extension of the base types through use of generics when instantiated. By default, all generics are set to `Record<string, unknown>`.

## Step-by-Step Guide:

### Step 1: Generate API key and ProjectID

Before installing ErmisChat SDK, you need to generate an **API key** and **ProjectID** on the [Ermis Dashboard](https://ermis.network). This **API key** and **ProjectID** will be required when initializing the Chat SDK.

> **Note**: Ermis Dashboard will be available soon. Please contact our support team to create a client account and receive your API key. Contact support: [tony@ermis.network](mailto:tony@ermis.network)

### Step 2: Install Chat SDK

You can install the Chat SDK with either `npm` or `yarn`.

**npm**

```bash
$ npm install ermis-chat-js-sdk
```

> Note: To use npm to install the Chat SDK, Node.js must be first installed on your system.

**yarn**

```bash
$ yarn add ermis-chat-js-sdk
```

### Step 3: Install WalletConnect

You need to install WalletConnect to sign in and login to the Chat SDK. For more details, refer to the [WalletConnect docs](https://docs.walletconnect.com/appkit/javascript/core/installation) and [Wagmi docs](https://wagmi.sh).

> Note: For a list of supported wallets, see [here](https://explorer.walletconnect.com/?type=wallet)

### Step 4: Integrate Login via Wallet

After installing WalletConnect, you need to import `ErmisAuth` from Ermis to connect to the login flow in Ermis Chat:

```javascript
import { ErmisAuth } from 'ermis-chat-js-sdk';
const options = {
  baseURL: BASE_URL,
}; // optional

const authInstance = ErmisAuth.getInstance(API_KEY, address, options);
```

#### 4.1 Create challenge

Create challenge message before signing with the wallet:

```javascript
const challenge = await authInstance.startAuth();
```

**Response**

```javascript
{
    "domain": {
        "name": "Defguard",
        "version": "1"
    },
    "types": {
        "EIP712Domain": [
            {
                "name": "name",
                "type": "string"
            },
            {
                "name": "version",
                "type": "string"
            }
        ],
        "ProofOfOwnership": [
            {
                "name": "wallet",
                "type": "address"
            },
            {
                "name": "content",
                "type": "string"
            },
            {
                "name": "nonce",
                "type": "string"
            }
        ]
    },
    "primaryType": "ProofOfOwnership",
    "message": {
        "wallet": "0x8eb718033b4a3c5f8bdea1773ded0259b2300f5d",
        "content": "Please read this carefully:Click to sign to prove you are in possesion of your private key to the account.This request will not trigger a blockchain transaction or cost any gas fees.",
        "nonce": "123b92be27edefdfd08395bd52b58f18544fb29dedd304bf33965ca04b050f91"
    }
}
```

#### 4.2 Sign wallet and Get Token

After receiving the challenge message, sign the wallet to get the signature using [useSignTypedData](https://wagmi.sh/react/api/hooks/useSignTypedData), then retrieve the token:

**Example**:

```javascript
import { useSignTypedData, useAccount } from 'wagmi';

function App() {
  const { signTypedData } = useSignTypedData();
  const { connector } = useAccount();

  const onSignMessage = () => {
    const { types, domain, primaryType, message } = challenge;

    let signature = '';
    signTypedDataAsync(
      {
        types,
        domain,
        connector,
        primaryType,
        message,
      },
      {
        onSuccess: (s) => {
          signature = s;
        },
      },
    );

    if (signature) {
      const response = await authInstance.getAuth(signature); // get token
    }
  };

  return <button onClick={onSignMessage}>Sign message</button>;
}
```

**Response**

```javascript
{
  "token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjoiMHg4ZWI3MTgwMzNiNGEzYzVmOGJkZWExNzczZGVkMDI1OWIyMzAwZjVkIiwiY2xpZW50X2lkIjoiNmZiZGVjYjAtMWVjOC00ZTMyLTk5ZDctZmYyNjgzZTMwOGI3IiwiY2hhaW5faWQiOjAsInByb2plY3RfaWQiOiJiNDQ5MzdlNC1jMGQ0LTRhNzMtODQ3Yy0zNzMwYTkyM2NlODMiLCJhcGlrZXkiOiJrVUNxcWJmRVF4a1pnZTdISERGY0l4Zm9IenFTWlVhbSIsImVybWlzIjp0cnVlLCJleHAiOjE4MjU1MzQ4MjI2NDMsImFkbWluIjpmYWxzZSwiZ2F0ZSI6ZmFsc2V9.nP2pIx1PAG-GrjNPgh8pJNfMfL-rX8YFpsDB-yFKjQs",
  "refresh_token": "Aeqds63dfXXKqGkUrgsS6K2O",
  "user_id": "0x8eb718033b4a3c5f8bdea1773ded0259b2300f5d",
  "project_id": "b44937e4-c0d4-4a73-847c-3730a923ce83"
}
```

### Step 5: Initialize the Chat SDk

On the client-side, initialize the Chat client with your **API key** and **ProjectID**:

```javascript
import { ErmisChat } from 'ermis-chat-js-sdk';

const options = {
  timeout: 6000,
  baseURL: BASE_URL,
}; // optional

const chatClient = ErmisChat.getInstance(API_KEY, PROJECT_ID, options);
```

Once initialized, you must specify the current user with connectUser:

```javascript
await chatClient.connectUser(
  {
    api_key: API_KEY,
    id: user_id,
    name: user_id,
  },
  token,
);
```

| Name    | Type   | Required | Description                                               |
| :------ | :----- | :------- | :-------------------------------------------------------- |
| user_id | string | Yes      | User ID obtained from the `getAuth` function              |
| token   | string | Yes      | Authentication token obtained from the `getAuth` function |

### Step 6: Sending your first message

Now that the Chat SDK has been imported, you're ready to start sending messages.
Here are the steps to send your first message using the Chat SDK:

**Send a message to the channel**:

```javascript
const channel = chatClient.channel(channel_type, channel_id);
await channel.sendMessage({
  text: 'Hello',
});
```

<br />

## Features

1. [User management](#user-management)
1. [Channel management](#channel-management)
1. [Message management](#message-management)
1. [Events](#events)

### User management

Get the users in your project to create a direct message.

#### 1. Query users

```javascript
const page = 1;
const page_size = 10;
await chatClient.queryUsers(page_size, page);
```

| Name      | Type   | Required | Description                           |
| :-------- | :----- | :------- | :------------------------------------ |
| page      | number | No       | The page number you want to query     |
| page_size | number | No       | The number of users returned per page |

**Response**

```javascript
{
  "data": [
      {
        "id": "0x9add536fb802c3eecdb2d94a29653e9b42cc4291",
        "name": "0x9add536fb802c3eecdb2d94a29653e9b42cc4291",
        "avatar": null,
        "about_me": null,
        "project_id": "b44937e4-c0d4-4a73-847c-3730a923ce83"
      },
      {
        "id": "0x360a45f70de193090a1b13da8393a02f9119aecd",
        "name": "vinhtc27",
        "avatar": "https://hn.storage.weodata.vn/namwifi/ermis/staging/wLdIngOpu8j9mp49oOhwWOzQyO31qjLK",
        "about_me": null,
        "project_id": "b44937e4-c0d4-4a73-847c-3730a923ce83"
      },
  ],
  "count": 8,
  "total": 8,
  "page": 1,
  "page_count": 1
}
```

#### 2. Search users

```javascript
const page = 1;
const page_size = 10;
const name = 'Tony';
await chatClient.searchUsers(page, page_size, name);
```

| Name      | Type   | Required | Description                           |
| :-------- | :----- | :------- | :------------------------------------ |
| page      | number | No       | The page number you want to query     |
| page_size | number | No       | The number of users returned per page |
| name      | string | Yes      | User name you want to query           |

**Response**

```javascript
{
  "data": [
      {
        "id": "0x9add536fb802c3eecdb2d94a29653e9b42cc4291",
        "name": "0x9add536fb802c3eecdb2d94a29653e9b42cc4291",
        "avatar": null,
        "about_me": null,
        "project_id": "b44937e4-c0d4-4a73-847c-3730a923ce83"
      },
      {
        "id": "0x360a45f70de193090a1b13da8393a02f9119aecd",
        "name": "vinhtc27",
        "avatar": "https://hn.storage.weodata.vn/namwifi/ermis/staging/wLdIngOpu8j9mp49oOhwWOzQyO31qjLK",
        "about_me": null,
        "project_id": "b44937e4-c0d4-4a73-847c-3730a923ce83"
      },
  ],
  "count": 8,
  "total": 8,
  "page": 1,
  "page_count": 1
}
```

#### 3. Get users by userIds

```javascript
const page = 1;
const page_size = 10;
const list_user_id = ['user_id_1', 'user_id_2', 'user_id_3'];
await chatClient.getBatchUsers(list_user_id, page, page_size);
```

| Name         | Type   | Required | Description                           |
| :----------- | :----- | :------- | :------------------------------------ |
| page         | number | No       | The page number you want to query     |
| page_size    | number | No       | The number of users returned per page |
| list_user_id | array  | Yes      | List user id you want to query        |

**Response**

```javascript
{
  "data": [
      {
        "id": "0x9add536fb802c3eecdb2d94a29653e9b42cc4291",
        "name": "0x9add536fb802c3eecdb2d94a29653e9b42cc4291",
        "avatar": null,
        "about_me": null,
        "project_id": "b44937e4-c0d4-4a73-847c-3730a923ce83"
      },
      {
        "id": "0x360a45f70de193090a1b13da8393a02f9119aecd",
        "name": "vinhtc27",
        "avatar": "https://hn.storage.weodata.vn/namwifi/ermis/staging/wLdIngOpu8j9mp49oOhwWOzQyO31qjLK",
        "about_me": null,
        "project_id": "b44937e4-c0d4-4a73-847c-3730a923ce83"
      },
  ],
  "count": 8,
  "total": 8,
  "page": 1,
  "page_count": 1
}
```

#### 4. Get user by user id

```javascript
const user_id = 'user_id_1';
await chatClient.queryUser(user_id);
```

**Response**

```javascript
{
  "name": "0x8eb718033b4a3c5f8bdea1773ded0259b2300f5d",
  "id": "0x8eb718033b4a3c5f8bdea1773ded0259b2300f5d",
  "avatar": null,
  "about_me": null,
  "project_id": "b44937e4-c0d4-4a73-847c-3730a923ce83"
}
```

#### 5. Update Personal Profile

```javascript
const name = 'Tony';
const about_me = 'My name is Tony';
await chatClient.updateProfile(name, about_me);
```

| Name     | Type   | Required | Description      |
| :------- | :----- | :------- | :--------------- |
| name     | string | Yes      | Your user name   |
| about_me | string | No       | Your description |

#### 6. Get contact

The function returns the list of `contact_user_ids` (direct channels) and `block_user_ids` (blocked users) in the chat SDK

```javascript
await chatClient.queryContacts();
```

**Response**

```javascript
{
  "contact_user_ids": [
    "0xa1ccc3bb50ad976d5cd6c772c4ccc5cd5e18de3a"
  ],
  "block_user_ids": [
    "0x8ba208a3bfb80edd7fc5febf5666e146a3c8722d"
  ]
}
```

#### 7. Real-Time User Info Updates with EventSource

User profile updates are received in real-time using Event Source, enabling automatic synchronization of user data changes.

**Connect**:

```javascript
const dataUser = (data) => {
  console.log(data);
};
await chatClient.connectToSSE(dataUser);
```

| Name     | Type | Required | Description                                                                                                                                                                                                                    |
| :------- | :--- | :------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dataUser | func | No       | The **dataUser** function can be used to receive user profile update data via an Event Source connection. When an update event occurs, the relevant user profile data will be sent to this function and logged to the console. |

**Disconnect**:

```javascript
await chatClient.disconnectFromSSE();
```

<br />

### Channel management

#### 1. Query channels

Retrieve all channels and Drirect Messages in your project. Here’s an example of how to query the list of channels:

```javascript
const filter = {
  type: ['messaging', 'team'],
  roles: ['owner', 'moder', 'member', 'pending'],
  other_roles: ['pending'], // optional
  blocked: true, // optional
  limit: 3, // optional
  offset: 0, // optional
};
const sort = [{ last_message_at: -1 }];
const options = {
  message_limit: 25,
};

await chatClient.queryChannels(filter, sort, options);
```

**Filter:**
Type: Object. The query filters to use. You can filter by any custom fields you've defined on the Channel.
| Name | Type | Required | Description |
| :-----------| :-- | :---------| :-----------|
| type | array | No | The type of channel: messaging, team. If the array is empty, it will return all channels.
| roles | array | No | This method is used to retrieve a list of channels that the current user is a part of. The API supports filtering channels based on the user's role within each channel, including roles such as `owner`, `moder`, `member`, and `pending`.<br /><br />`owner` - Retrieves a list of channels where the user's role is the owner. <br />`moder` - Retrieves a list of channels where the user's role is the moderator. <br />`member` - Retrieves a list of channels where the user's role is a member. <br /> `pending` - Retrieves a list of channels where the user's role is pending approval.
| other_roles | array | No | This API allows you to retrieve a list of channels that you have created, with the ability to filter channels based on the roles of other users within the channel. The roles available for filtering include: `owner`, `moder`, `member`, and `pending`.<br /><br /> `owner` - Filter channels where the user is the channel owner.<br /> `moder` - Filter channels where the user is a moderator.<br /> `member` - Filter channels where the user is a member. <br /> `pending` - Filter channels where the user is pending approval.
| blocked | boolean | No | Filter channels based on the `blocked` boolean field. If `true`, filter blocked direct channels. If `false`, filter non-blocked channels. If not provided, filter all channels.
| limit | integer | No | The maximum number of channels to retrieve in a single request.
| offset | integer | No | The starting position for data retrieval. This parameter allows you to retrieve channels starting from a specific position, useful for paginating through results. For example, offset: 30 will start retrieving channels from position 31 in the list.

**Sort:**
Type: Object or array of objects. The sorting used for the channels that match the filters. Sorting is based on the field and direction, and multiple sorting options can be provided. You can sort based on fields such as `last_message_at`. Direction can be ascending (1) or descending (-1).

```javascript
const sort = [{ last_message_at: -1 }];
```

**Options:**
Type: Object. This method can be used to fetch information about existing channels, including message counts and other related details.
| Name | Type | Required | Description |
| :-----------| :--- | :---------| :-----------|
| message_limit | integer | No | The maximum number of messages to retrieve from each channel. If this parameter is not provided, the default number of messages or no limit will be applied.

```javascript
const options = { message_limit: 25 };
```

#### 2. Create a New Channel

To create a channel: choose Direct for 1-1 (messaging) or Channel (team) for multiple users.

**New direct message**

```javascript
// channel type is messaging
const channel = await chatClient.channel('messaging', {
  members: ['user_id_1', 'my_user_id'],
});
await channel.create();
```

| Name    | Type  | Required | Description                                                                   |
| :------ | :---- | :------- | :---------------------------------------------------------------------------- |
| members | array | Yes      | an array with two user IDs: the creator's user ID and the recipient's user ID |

**New channel**

```javascript
// channel type is team
const channel = await chatClient.channel('team', {
  name: 'Ermis group',
  members: ['user_id_1', 'user_id_2', 'user_id_3', ...],
});
await channel.create();
```

| Name    | Type   | Required | Description                                      |
| :------ | :----- | :------- | :----------------------------------------------- |
| name    | string | Yes      | Display name for the channel                     |
| members | array  | Yes      | List user id you want to adding for this channel |

> **Note**: The channel is created, allowing only the creator's friends to be added, maintaining security and connection.

#### 3. Accept/Reject Invite

**Accept the invitation**

```javascript
// initialize the channel
const channel_type = 'team'; // or 'messaging'
const channel_id = 'b44937e4-c0d4-4a73-847c-3730a923ce83:65c07c7cc7c28e32d8f797c2e13c3e02f1fd';
const channel = chatClient.channel(channel_type, channel_id);

// accept the invite
await channel.acceptInvite();
```

**Reject the invitation**

```javascript
// initialize the channel
const channel_type = 'team'; // or 'messaging'
const channel_id = 'b44937e4-c0d4-4a73-847c-3730a923ce83:65c07c7cc7c28e32d8f797c2e13c3e02f1fd';
const channel = chatClient.channel(channel_type, channel_id);

// accept the invite
await channel.rejectInvite();
```

#### 4. Query a Channel

Queries the channel state and returns information about members, watchers and messages.

```javascript
const channel_type = 'team'; // or 'messaging'
const channel_id = 'b44937e4-c0d4-4a73-847c-3730a923ce83:65c07c7cc7c28e32d8f797c2e13c3e02f1fd';
const channel = chatClient.channel(channel_type, channel_id);

await channel.query();
```

You can use message query functionality: These functions support features such as scrolling, searching, and jumping to specific messages by retrieving messages older than, newer than, or around a given `message_id`:

**4.1. Query Older Messages (`queryMessagesLessThanId`)**

Retrieves a list of messages older than the message with `message_id`, limited by the `limit` parameter. Default limit is 25

```javascript
const message_id = '99873843-757f-4b3a-95d0-0773314fb115';
const limit = 25;

await channel.queryMessagesLessThanId(message_id, limit);
```

**4.2. Query Newer Messages (`queryMessagesGreaterThanId`)**

Retrieves a list of messages newer than the message with `message_id`, limited by the `limit` parameter. Default limit is 25

```javascript
const message_id = '99873843-757f-4b3a-95d0-0773314fb115';
const limit = 25;

await channel.queryMessagesGreaterThanId(message_id, limit);
```

**4.3. Query Messages Around (`queryMessagesAroundId`)**

Retrieves a list of messages around the message with `message_id`, limited by the `limit` parameter. Default limit is 25

```javascript
const message_id = '99873843-757f-4b3a-95d0-0773314fb115';
const limit = 25;

await channel.queryMessagesAroundId(message_id, limit);
```

#### 5. Setting a channel

The channel settings feature allows users to customize channel attributes such as name, description, membership permissions, and notification settings to suit their communication needs.

**5.1. Edit channel information (name, avatar, description)**

```javascript
const payload = { name, image, description };

await channel.update(payload);
```

| Name        | Type   | Required | Description                  |
| :---------- | :----- | :------- | :--------------------------- |
| name        | string | No       | Display name for the channel |
| image       | string | No       | Avatar for the channel       |
| description | string | No       | Description for the channel  |

**5.2. Adding, Removing & Leaving Channel Members**
The addMembers() method adds specified users as members, while removeMembers() removes them.

**Adding members**
List user id you want to adding

```javascript
const list_user_id = ['user_id_1', 'user_id_2', 'user_id_3'];
await channel.addMembers(list_user_id);
```

**Removing members**
List user id you want to removing

```javascript
const list_user_id = ['user_id_1', 'user_id_2', 'user_id_3'];
await channel.removeMembers(list_user_id);
```

**Leaving a channel**
Allows the user to leave the channel, removing themselves from the conversation and any future notifications

```javascript
await channel.removeMembers(['my_user_id']);
```

**5.3. Adding & Removing Moderators to a Channel**
The addModerators() method adds a specified user as a Moderators (or updates their role to moderator if already members), while demoteModerators() removes the moderator status.

**Adding Moderator**
List user id you want to adding

```javascript
const list_user_id = ['user_id_1', 'user_id_2', 'user_id_3'];
await channel.addModerators(list_user_id);
```

**Removing Moderator**
List user id you want to removing

```javascript
const list_user_id = ['user_id_1', 'user_id_2', 'user_id_3'];
await channel.demoteModerators(list_user_id);
```

**5.4. Ban & Unban Channel Members**
The ban and unban feature allows administrators to block or unblock members with the "member" role in a channel, managing their access rights.

**Ban a Channel Member**
List user id you want to ban

```javascript
const list_user_id = ['user_id_1', 'user_id_2', 'user_id_3'];
await channel.banMembers(list_user_id);
```

**Unban a Channel Member**
List user id you want to unban

```javascript
const list_user_id = ['user_id_1', 'user_id_2', 'user_id_3'];
await channel.unbanMembers(list_user_id);
```

**5.5. Channel Capabilities**
This feature allows `owner` role to configure permissions for members with the `member` role, enabling a capability adds it to the capabilities, disabling it removes it from the capabilities.

```javascript
const capabilities = channel.getCapabilitiesMember();
await channel.updateCapabilities(capabilities);
```

| Name         | Type  | Required | Description                                                                                                                                  |
| :----------- | :---- | :------- | :------------------------------------------------------------------------------------------------------------------------------------------- |
| capabilities | array | Yes      | Capabilities you want to adding to the member in channel. Enabling a capability adds it to the array, disabling it removes it from the array |

**Get capabilities with the `member` role in channel**
Retrieves the permissions for a member with the role of "member," helping to identify their rights and functions within the channel

```javascript
channel.getCapabilitiesMember();
```

**Name Capabilities**
These are the permissions applied to members within a channel.

| Name                  | What it indicates                               |
| :-------------------- | :---------------------------------------------- |
| `send-message`        | Ability to send a message                       |
| `update-own-message`  | Ability to update own messages in the channel   |
| `delete-own-message`  | Ability to delete own messages from the channel |
| `send-reaction`       | Ability to send reactions                       |
| `create-call`         | Ability to create call in the channel           |
| `join-call`           | Ability to join call in the channel             |
| `send-links`          | Ability to send links messages in the channel   |
| `quote-message`       | Ability to quote message in the channel         |
| `send-reply`          | Ability to send reply message in the channel    |
| `search-messages`     | Ability to search messages in the channel       |
| `send-typing-events`  | Ability to send typing events in the channel    |
| `upload-file`         | Ability to upload file in the channel           |
| `delete-own-reaction` | Ability to delete reaction in the channel       |

**5.6. Query Attachments in a channel**
This feature allows users to view all media files shared in a channel, including images, videos, and audio.

```javascript
await channel.queryAttachmentMessages();
```

**Response**

```javascript
{
  "attachments": [
    {
      "id": "3fe7e002-2c71-48bc-b051-a284825969a7",
      "user_id": "0x8eb718033b4a3c5f8bdea1773ded0259b2300f5d",
      "cid": "messaging:b44937e4-c0d4-4a73-847c-3730a923ce83:65c07c7cc7c28e32d8f797c2e13c3e02f1fd",
      "url": "https://hn.storage.weodata.vn/belochat/bellboy/test/messaging:b44937e4-c0d4-4a73-847c-3730a923ce83:65c07c7cc7c28e32d8f797c2e13c3e02f1fd/3fe7e002-2c71-48bc-b051-a284825969a7",
      "thumb_url": "",
      "file_name": "about3.png",
      "content_type": "image/png",
      "content_length": 34781,
      "content_disposition": "inline; filename=\"about3.png\"",
      "message_id": "1b1d81fd-3bfe-4ac0-ad83-4f7b99ce2252",
      "created_at": "2024-08-29T11:22:41.210527653+00:00",
      "updated_at": "2024-08-29T11:22:41.210531736+00:00"
    },
  ],
  "duration": "1ms"
}
```

**5.7. Block & Unblock a Direct channel**
Allows users to block any user in their DM list. Users can unblock at any time while retaining the previous conversation history.

> **Note**: Only allows block/unblock for direct channels with type `messaging`, not applicable for group channels with type `team`

**Block a Direct channel**
The block direct channel feature prevents users from sending messages, triggering the `member.blocked` event via WebSocket

```javascript
await channel.blockUser();
```

**Unblock a Direct channel**
The unblock direct channel feature allows users to resume messaging, triggering the `member.unblocked` event via WebSocket.

```javascript
await channel.unblockUser();
```

**5.8. Set cooldown messages for channel**
Cooldown messages for a `team` channel are set by admin or moderators, limiting how frequently members can send messages.

> **Note**: Only allows set cooldown messages for group channels with type `team`, not applicable for direct channels with type `messaging`

```javascript
const miliseconds = 10000;
await channel.update({ member_message_cooldown: miliseconds });
```

**Cooldown periods:**

- `0` milliseconds: No cooldown, members can send messages without any delay
- `10000` milliseconds (10 seconds): Members must wait 10 seconds between sending messages
- `30000` milliseconds (30 seconds): Members must wait 30 seconds between sending messages
- `60000` milliseconds (1 minute): Members must wait 1 minute between sending messages
- `300000` milliseconds (5 minutes): Members must wait 5 minutes between sending messages
- `900000` milliseconds (15 minutes): Members must wait 15 minutes between sending messages
- `3600000` milliseconds (1 hour): Members must wait 1 hour between sending messages

| Name                    | Type   | Required | Description                                                                                  |
| :---------------------- | :----- | :------- | :------------------------------------------------------------------------------------------- |
| member_message_cooldown | number | Yes      | is the waiting time (in milliseconds) between messages that members can send in the channel. |

<br />

### Message management

#### 1. Sending a message

This feature allows user to send a message to a specified channel or DM:

**1.1 Send text message**

```javascript
await channel.sendMessage({
  text: 'Hello',
});
```

**Response**

```javascript
{
  "message": {
    "id": "99873843-757f-4b3a-95d0-0773314fb115",
    "text": "Hello",
    "type": "regular",
    "cid": "messaging:b44937e4-c0d4-4a73-847c-3730a923ce83:65c07c7cc7c28e32d8f797c2e13c3e02f1fd",
    "user": {
      "id": "0x8eb718033b4a3c5f8bdea1773ded0259b2300f5d"
    },
    "created_at": "2024-08-29T10:44:40.022289401+00:00"
  },
  "duration": "0ms"
}
```

**1.2 Send attachments message**
Before sending messages with images, videos, or file attachments, users need to [upload the files](#2-upload-file) to the system for sending.

```javascript
await channel.sendMessage({
  attachments: [
    {
      type: 'image',
      image_url: 'https://bit.ly/2K74TaG',
      title: 'photo.png',
      file_size: 2020,
      mime_type: 'image/png',
    },
  ],
});
```

**Response**

```javascript
{
  "message": {
    "id": "398b7c12-e412-493c-9f37-0b1d2842d339",
    "text": "",
    "type": "regular",
    "cid": "messaging:b44937e4-c0d4-4a73-847c-3730a923ce83:65c07c7cc7c28e32d8f797c2e13c3e02f1fd",
    "user": {
        "id": "0x8eb718033b4a3c5f8bdea1773ded0259b2300f5d"
    },
    "created_at": "2024-09-07T12:49:17.037397729+00:00",
    "attachments": [
      {
        "title": "photo_webclip.png",
        "file_size": 4584,
        "type": "image",
        "mime_type": "image/png",
        "image_url": "https://bit.ly/2K74TaG"
      }
    ]
  },
  "duration": "3ms"
}
```

**Attachments Format**
`attachments` is an array containing objects that represent different types of attachments such as images, videos, or files. Each object has the following fields:

- `type`: The type of file (image, video, file)
- `image_url` or `asset_url`: URL of the file after uploading
- `title`: The name of the file
- `file_size`: The size of the file (in bytes)
- `mime_type`: The MIME type of the file
- `thumb_url`: Thumbnail URL (applies to videos)

**Example**

```javascript
const attachments = [
  {
    type: 'image', // Upload file image
    image_url: 'https://bit.ly/2K74TaG', // url from response upload file
    title: 'photo.png',
    file_size: 2020,
    mime_type: 'image/png',
  },
  {
    type: 'video', // Upload file video
    asset_url: 'https://bit.ly/2K74TaG', // url from response upload file
    file_size: 10000,
    mime_type: 'video/mp4',
    title: 'video name',
    thumb_url: 'https://bit.ly/2Uumxti',
  },
  {
    type: 'file', // Upload another file
    asset_url: 'https://bit.ly/3Agxsrt', // url from response upload file
    file_size: 2000,
    mime_type: 'application/msword',
    title: 'file name',
  },
];
```

**Get thumb blob from video**
Extract a thumbnail from a video file, converting it to a Blob if the uploaded file is a video. After upload file

```javascript
await channel.getThumbBlobVideo(file);
```

**1.3 Reply a message**
The reply feature allows users to directly respond to a specific message, displaying the original message content alongside the reply.

```javascript
await channel.sendMessage({
  text: 'Hello',
  quoted_message_id: '99873843-757f-4b3a-95d0-0773314fb115',
});
```

**Response**

```javascript
{
  "message": {
    "id": "cc7d8206-0f67-4b2b-8f8d-8a721ee0a4b1",
    "text": "hehe",
    "type": "reply",
    "cid": "messaging:b44937e4-c0d4-4a73-847c-3730a923ce83:65c07c7cc7c28e32d8f797c2e13c3e02f1fd",
    "user": {
      "id": "0x8eb718033b4a3c5f8bdea1773ded0259b2300f5d"
    },
    "created_at": "2024-09-07T12:47:58.398896591+00:00",
    "quoted_message_id": "eacc4834-1b73-4eca-9108-409f1f9a91db",
    "quoted_message": {
      "id": "eacc4834-1b73-4eca-9108-409f1f9a91db",
      "text": "hello",
      "type": "regular",
      "cid": "messaging:b44937e4-c0d4-4a73-847c-3730a923ce83:65c07c7cc7c28e32d8f797c2e13c3e02f1fd",
      "user": {
        "id": "0x8eb718033b4a3c5f8bdea1773ded0259b2300f5d"
      },
      "created_at": "2024-09-06T10:27:50.361815802+00:00"
    }
  },
  "duration": "0ms"
}
```

#### 2. Upload file

This feature allows user to upload a file to the system. Maximum file size is 2GB

```javascript
await channel.sendFile(file);
```

**Response**

```javascript
{
  "file": "https://hn.storage.weodata.vn/belochat/bellboy/test/team:b44937e4-c0d4-4a73-847c-3730a923ce83:ac7018e7-d398-4053-80f0-116aefc80682/5295276b-41d4-4738-b9fd-7b2f3c005a23",
  "duration": "277ms"
}
```

#### 3. Edit message

The edit message feature enables users to modify and update the content of a previously sent message in a chat

```javascript
const message_id = '99873843-757f-4b3a-95d0-0773314fb115';
const text = 'Hello';

await channel.editMessage(message_id, text);
```

**Response**

```javascript
{
  "message": {
    "id": "99873843-757f-4b3a-95d0-0773314fb115",
    "text": "Hello",
    "type": "regular",
    "cid": "messaging:b44937e4-c0d4-4a73-847c-3730a923ce83:65c07c7cc7c28e32d8f797c2e13c3e02f1fd",
    "user": {
        "id": "0x8eb718033b4a3c5f8bdea1773ded0259b2300f5d"
    },
    "created_at": "2024-08-29T10:44:40.022289401+00:00"
  },
  "duration": "0ms"
}
```

#### 4. Delete message

The delete message feature allows users to remove a previously sent message from the chat for all participants

```javascript
const message_id = '99873843-757f-4b3a-95d0-0773314fb115';
await channel.deleteMessage(message_id);
```

**Response**

```javascript
{
  "message": {
    "id": "99873843-757f-4b3a-95d0-0773314fb115",
    "text": "Hello",
    "type": "regular",
    "cid": "messaging:b44937e4-c0d4-4a73-847c-3730a923ce83:65c07c7cc7c28e32d8f797c2e13c3e02f1fd",
    "user": {
        "id": "0x8eb718033b4a3c5f8bdea1773ded0259b2300f5d"
    },
    "created_at": "2024-08-29T10:44:40.022289401+00:00"
  },
  "duration": "0ms"
}
```

#### 5. Search message

The message search feature returns up to 25 messages per query, helping users efficiently find specific messages in the chat

```javascript
const search_term = 'Hello';
const offset = 0;

await channel.searchMessage(search_term, offset);
```

| Name        | Type   | Required | Description                                               |
| :---------- | :----- | :------- | :-------------------------------------------------------- |
| search_term | string | Yes      | Keyword used to filter the messages.                      |
| offset      | number | Yes      | Starting position for retrieving search data in the list. |

**Response**

```javascript
{
  "search_result": {
    "limit": 25,
    "offset": 0,
    "total": 3,
    "messages": [
      {
          "id": "53cd8db1-117e-4409-817c-025a491f2064",
          "text": "tuan",
          "user_id": "0x8eb718033b4a3c5f8bdea1773ded0259b2300f5d",
          "created_at": "2024-08-29T10:56:45.474470888+00:00"
      },
      {
          "id": "c046f53c-22cd-4c87-9686-0e13a3d9b796",
          "text": "tuan 1",
          "user_id": "0x8eb718033b4a3c5f8bdea1773ded0259b2300f5d",
          "created_at": "2024-08-29T10:56:46.476760621+00:00"
      },
      {
          "id": "b9339abe-eb4f-43a7-954b-9397bf1a77ca",
          "text": "tuan 2",
          "user_id": "0x8eb718033b4a3c5f8bdea1773ded0259b2300f5d",
          "created_at": "2024-08-29T10:56:47.392938048+00:00"
      }
    ]
  },
  "duration": "16ms"
}
```

#### 6. Unread messages

Retrieves messages that have not been read by the user, helping to keep track of new or pending messages

**6.1 Unread messages in a channel**
By using `countUnread()`, you can retrieve the total number of unread messages of a user in a group channel.

```javascript
channel.countUnread();
```

**6.2 Get member unread messages**
`getUnreadMemberCount()` Determines the number of members in the channel who have not read the messages. This function helps manage and track the read status of messages among channel members.

```javascript
channel.getUnreadMemberCount();
```

**6.3 Marking a channel as read**
You can mark all messages in a channel as read on the client-side:

```javascript
await channel.markRead();
```

**6.4 Jump to last read message**
This is how you can jump to the last read message in a specific channel:

```javascript
const lastReadMessageId = channel.state.read['<user id>'];
await channel.state.loadMessageIntoState(lastReadMessageId);

console.log(channel.state.messages);
```

#### 7. Reactions

The Reaction feature allows users to send, manage reactions on messages, and delete reactions when necessary.

The message reaction feature allows users to quickly respond with five types of reactions: 'haha', 'like', 'love', 'sad', and 'fire'.

**Example**

```javascript
const EMOJI_QUICK = [
  {
    type: 'haha',
    value: '😂',
  },
  {
    type: 'like',
    value: '👍',
  },
  {
    type: 'love',
    value: '❤️',
  },
  {
    type: 'sad',
    value: '😔',
  },
  {
    type: 'fire',
    value: '🔥',
  },
];
```

**7.1. Send a reaction:**

```javascript
const message_id = '99873843-757f-4b3a-95d0-0773314fb115';
const reaction_type = 'love';

await channel.sendReaction(message_id, reaction_type);
```

| Name          | Type   | Required | Description                                                                    |
| :------------ | :----- | :------- | :----------------------------------------------------------------------------- |
| message_id    | string | Yes      | ID of the message to react to                                                  |
| reaction_type | string | Yes      | Type of the reaction. User could have only 1 reaction of each type per message |

**Response**

```javascript
{
  "message": {
    "id": "b9339abe-eb4f-43a7-954b-9397bf1a77ca",
    "text": "tuan 2",
    "type": "regular",
    "cid": "messaging:b44937e4-c0d4-4a73-847c-3730a923ce83:65c07c7cc7c28e32d8f797c2e13c3e02f1fd",
    "user": {
        "id": "0x8eb718033b4a3c5f8bdea1773ded0259b2300f5d"
    },
    "created_at": "2024-08-29T10:56:47.392938048+00:00",
    "latest_reactions": [
        {
          "message_id": "b9339abe-eb4f-43a7-954b-9397bf1a77ca",
          "user_id": "0x8eb718033b4a3c5f8bdea1773ded0259b2300f5d",
          "user": {
              "id": "0x8eb718033b4a3c5f8bdea1773ded0259b2300f5d"
          },
          "type": "love",
          "created_at": "2024-08-29T11:01:04.533983699+00:00",
          "updated_at": "2024-08-29T11:01:04.533987884+00:00"
        }
    ],
    "reaction_counts": {
        "love": 1
    }
  },
  "reaction": {
    "message_id": "b9339abe-eb4f-43a7-954b-9397bf1a77ca",
    "user_id": "0x8eb718033b4a3c5f8bdea1773ded0259b2300f5d",
    "user": {
        "id": "0x8eb718033b4a3c5f8bdea1773ded0259b2300f5d"
    },
    "type": "love",
    "created_at": "2024-08-29T11:01:04.533983699+00:00",
    "updated_at": "2024-08-29T11:01:04.533987884+00:00"
  },
  "duration": "21ms"
}
```

**7.2. Delete a reaction:**

```javascript
const message_id = '99873843-757f-4b3a-95d0-0773314fb115';
const reaction_type = 'love';

await channel.deleteReaction(message_id, reaction_type);
```

| Name          | Type   | Required | Description                                                                    |
| :------------ | :----- | :------- | :----------------------------------------------------------------------------- |
| message_id    | string | Yes      | ID of the message to react to                                                  |
| reaction_type | string | Yes      | Type of the reaction. User could have only 1 reaction of each type per message |

#### 8. Typing Indicators

Typing indicators feature lets users see who is currently typing in the channel

```javascript
// sends a typing.start event at most once every two seconds
await channel.keystroke();

// sends the typing.stop event
await channel.stopTyping();
```

When sending events on user input, you should make sure to follow some best-practices to avoid bugs.

- Only send `typing.start` when the user starts typing
- Send `typing.stop` after a few seconds since the last keystroke

**Receiving typing indicator events**

```javascript
// start typing event handling
channel.on('typing.start', (event) => {
  console.log(event);
});

// stop typing event handling
channel.on('typing.stop', (event) => {
  console.log(event);
});
```

#### 9. System message

Below you can find the complete list of system message that are returned by messages from channel. You can define from syntax message by description.

| Name                            | Syntax                   | Description                                        |
| :------------------------------ | :----------------------- | :------------------------------------------------- |
| UpdateChannelName               | `1 user_id channel_name` | Member X updated name of channel                   |
| UpdateChannelImage              | `2 user_id`              | Member X updated image of channel                  |
| UpdateChannelDescription        | `3 user_id`              | Member X updated description of channel            |
| MemberRemoved                   | `4 user_id`              | Member X has been removed from this channel        |
| MemberBanned                    | `5 user_id`              | Member X has been banned from interacting          |
| MemberUnbanned                  | `6 user_id`              | Member X has been unbanned from interacting        |
| MemberPromoted                  | `7 user_id`              | Member X has been assigned as the moderator        |
| MemberDemoted                   | `8 user_id`              | Member X has been demoted to member                |
| UpdateChannelMemberCapabilities | `9 user_id`              | Member X has updated member permission of channel  |
| InviteAccepted                  | `10 user_id`             | Member X has joined this channel                   |
| InviteRejected                  | `11 user_id`             | Member X has rejected to join this channel         |
| MemberLeave                     | `12 user_id`             | Member X has leaved this channel                   |
| TruncateMessages                | `13 user_id`             | Member X has truncate all messages of this channel |
| UpdateMemberMessageCooldown     | `15 user_id duration`    | Member X has update channel message cooldown       |
| UpdateFilterWords               | `16 user_id`             | Member X has update channel filter words           |

<br />

### Events

Events keep the client updated with changes in a channel, such as new messages, reactions, or members joining the channel.
A full list of events is shown below. The next section of the documentation explains how to listen for these events.
| Event | Trigger | Recipients
|:---|:----|:-----
| `health.check` | every 30 second to confirm that the client connection is still alive | all clients
| `message.new` | when a new message is added on a channel | clients watching the channel
| `message.read` | when a channel is marked as read | clients watching the channel
| `message.deleted` | when a message is deleted | clients watching the channel
| `message.updated` | when a message is updated | clients watching the channel
| `typing.start` | when a user starts typing | clients watching the channel
| `typing.stop` | when a user stops typing | clients watching the channel
| `reaction.new` | when a message reaction is added | clients watching the channel
| `reaction.deleted` | when a message reaction is deleted | clients watching the channel
| `member.added` | when a member is added to a channel | clients watching the channel
| `member.removed` | when a member is removed from a channel | clients watching the channel
| `member.promoted` | when a member is added moderator to a channel | clients watching the channel
| `member.demoted` | when a member is removed moderator to a channel | clients watching the channel
| `member.banned` | when a member is ban to a channel | clients watching the channel
| `member.unbanned` | when a member is unban to a channel | clients watching the channel
| `member.blocked` | when a direct channel is blocked | clients watching the channel
| `member.unblocked` | when a direct channel is unblocked | clients watching the channel
| `notification.added_to_channel` | when the user is added to the list of channel members | clients from the user added that are not watching the channel
| `notification.invite_accepted` | when the user accepts an invite | clients from the user invited that are not watching the channel
| `notification.invite_rejected` | when the user rejects an invite | clients from the user invited that are not watching the channel
| `channel.deleted` | when a channel is deleted | clients watching the channel
| `channel.updated` | when a channel is updated | clients watching the channel

#### 1. Listening for Events

Once you call watch on a Channel or queryChannels, you will start listening for these events. You can then hook into specific events:

```javascript
channel.on('message.deleted', (event) => {
  console.log('event', event);
});
```

You can also listen to all events at once:

```javascript
channel.on((event) => {
  console.log('event', event);
});
```

#### 2. Client Events

Not all events are specific to channels. Events such as changes in the user's status,unread count, and other notifications are sent as client events. These events can be listened to directly through the client:

```javascript
chatClient.on((event) => {
  console.log('event', event);
});
```

#### 3. Stop listening for Events

It is good practice to unregister event handlers when they are no longer in use. This helps prevent performance issue due to memory leaks and avoids potential errors and exceptions (i.e. null pointer exceptions)

```javascript
// remove the handler from all client events
// const myClientEventListener = client.on('connection.changed', myClientEventHandler)
myClientEventListener.unsubscribe();

// remove the handler from all events on a channel
// const myChannelEventListener = channel.on('connection.changed', myChannelEventHandler)
myChannelEventListener.unsubscribe();
```

## Error codes

Below you can find the complete list of errors that are returned by the API together with the description, API code, and corresponding HTTP, Websocket status of each error.

#### 1. HTTP codes

| Name                      | HTTP Status Code | HTTP Status           | Ermis code | Description                                               |
| :------------------------ | :--------------- | :-------------------- | :--------- | --------------------------------------------------------- |
| InternalServerError       | 500              | Internal Server Error | 0          | Triggered when something goes wrong in our system         |
| ServiceUnavailable        | 503              | Service Unavailable   | 1          | Triggered when our system is unavailable to call          |
| Unauthorized              | 401              | Unauthorized          | 2          | Invalid JWT token                                         |
| NotFound                  | 404              | Not Found             | 3          | Resource not found                                        |
| InputError                | 400              | Bad Request           | 4          | When wrong data/parameter is sent to the API              |
| ChannelNotFound           | 400              | Bad Request           | 5          | Channel is not existed                                    |
| NoPermissionInChannel     | 400              | Bad Request           | 6          | No permission for this action in the channel              |
| NotAMemberOfChannel       | 400              | Bad Request           | 7          | Not a member of channel                                   |
| BannedFromChannel         | 400              | Bad Request           | 8          | User is banned from this channel                          |
| HaveToAcceptInviteFirst   | 400              | Bad Request           | 9          | User must accept the invite to gain permission            |
| DisabledChannelMemberCapa | 400              | Bad Request           | 10         | This action is disable for channel member role            |
| AlreadyAMemberOfChannel   | 400              | Bad Request           | 11         | User is already part of the channel and cannot join again |

#### 2. Websocket codes

| Websocket Code | Message          | Description                                   |
| :------------- | :--------------- | :-------------------------------------------- |
| 1011           | Internal Error   | Return when something wrong in our system     |
| 1006           | Abnormal Closure | Return when there is connection error         |
| 1005           | Jwt Expire       | Return when jwt is expired                    |
| 1003           | Unsupported Data | Return when client send non text data         |
| 1000           | Normal Closure   | Return when client or server close connection |
