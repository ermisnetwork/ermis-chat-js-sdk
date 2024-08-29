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

### Supported browsers

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

### Step 4: Integrate Login via Wallet

After installing WalletConnect, import the WalletConnect to initialize it:

```javascript
import { WalletConnect } from 'ermis-chat-js-sdk';
const authInstance = WalletConnect.getInstance(API_KEY, address);
```

#### 4.1: Create challenge

Create challenge message before signing with the wallet:

```javascript
const challenge = await authInstance.startAuth();
```

#### 4.2: Sign wallet and Get Token

After receiving the challenge message, sign the wallet to get the signature using [useSignTypedData](https://wagmi.sh/react/api/hooks/useSignTypedData), then retrieve the token:

```javascript
const response = await authInstance.getAuth(api_key, address, signature);
```

### Step 5: Import the Chat SDk

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
    id: address, // your address
    name: address,
  },
  `Bearer ${token}`,
);
```

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
await chatClient.queryUsers(page_size, page);
```

| Name      | Type   | Required | Description                           |
| :-------- | :----- | :------- | :------------------------------------ |
| page      | number | No       | The page number you want to query     |
| page_size | number | No       | The number of users returned per page |

#### 2. Search users

```javascript
await chatClient.searchUsers(page, page_size, name);
```

| Name      | Type   | Required | Description                           |
| :-------- | :----- | :------- | :------------------------------------ |
| page      | number | No       | The page number you want to query     |
| page_size | number | No       | The number of users returned per page |
| name      | string | Yes      | User name you want to query           |

#### 3. Get users by userIds

```javascript
await chatClient.getBatchUsers(users, page, page_size);
```

| Name      | Type   | Required | Description                           |
| :-------- | :----- | :------- | :------------------------------------ |
| page      | number | No       | The page number you want to query     |
| page_size | number | No       | The number of users returned per page |
| users     | array  | Yes      | List user id you want to query        |

#### 4. Get user by user id

```javascript
await chatClient.queryUser(user_id);
```

#### 5. Update Personal Profile

```javascript
await chatClient.updateProfile(name, about_me);
```

| Name     | Type   | Required | Description      |
| :------- | :----- | :------- | :--------------- |
| name     | string | Yes      | Your user name   |
| about_me | string | No       | Your description |

#### 6. Get contact

Get all your contacts in a project:

```javascript
await chatClient.queryContacts();
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
| other_roles | array | No | This API allows you to retrieve a list of channels that you have created, with the ability to filter channels based on the roles of other users within the channel. The roles available for filtering include: `owner`, `moder`, `member`, and `pending`.<br /><br /> `owner` - Filter channels where the user is the channel owner.</br> `moder` - Filter channels where the user is a moderator.</br> `member` - Filter channels where the user is a member. </br> `pending` - Filter channels where the user is pending approval.
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
const channel = chatClient.channel(channel_type, channel_id);

// accept the invite
await channel.acceptInvite();
```

**Reject the invitation**

```javascript
// initialize the channel
const channel = chatClient.channel(channel_type, channel_id);

// accept the invite
await channel.rejectInvite();
```

#### 4. Query a Channel

Queries the channel state and returns information about members, watchers and messages.

```javascript
const channel = chatClient.channel(channel_type, channel_id);
await channel.query();
```

You can use conditional parameters to filter messages based on their message IDs.
| Name | Type | Required | Description |
| :---------| :----| :---------| :-----------|
| id_lt | string | No | Filters messages with message id less than the specified value.
| id_gt | string | No | Filters messages with message id greater than the specified value.
| id_around | string | No | Filters messages around a specific message id, potentially including messages before and after that message id.

**Example:**

```javascript
const messages = {
  limit: 25,
  id_lt: message_id,
};

const channel = chatClient.channel(channel_type, channel_id);
await channel.query({
  messages, // optional
});
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

**5.2. Adding & Removing Channel Members**
The addMembers() method adds specified users as members, while removeMembers() removes them.

**Adding members**

```javascript
await channel.addMembers(userIds);
```

**Removing members**

```javascript
await channel.removeMembers(userIds);
```

**Leaving a channel**

```javascript
await channel.removeMembers(['my_user_id']);
```

| Name    | Type  | Required | Description                                 |
| :------ | :---- | :------- | :------------------------------------------ |
| userIds | array | Yes      | List user id you want to adding or removing |

**5.3. Adding & Removing Moderators to a Channel**
The addModerators() method adds a specified user as a Moderators (or updates their role to moderator if already members), while demoteModerators() removes the moderator status.

**Adding a Moderator**

```javascript
await channel.addModerators(userIds);
```

**Removing a Moderator**

```javascript
await channel.demoteModerators(userIds);
```

| Name    | Type  | Required | Description                                 |
| :------ | :---- | :------- | :------------------------------------------ |
| userIds | array | Yes      | List user id you want to adding or removing |

**5.4. Ban & Unban Channel Members**
The ban and unban feature allows administrators to block or unblock members with the "member" role in a channel, managing their access rights.

**Ban a Channel Member**

```javascript
await channel.banMembers(userIds);
```

**Unban a Channel Member**

```javascript
await channel.unbanMembers(userIds);
```

| Name    | Type  | Required | Description                           |
| :------ | :---- | :------- | :------------------------------------ |
| userIds | array | Yes      | List user id you want to ban or unban |

**5.5. Channel Capabilities**
This feature allows owner to configure permissions for members with the "member" role to send, edit, delete, and react to messages, ensuring chat content control.

```javascript
await channel.updateCapabilities(add_capabilities, remove_capabilities);
```

| Name                | Type  | Required | Description                       |
| :------------------ | :---- | :------- | :-------------------------------- |
| add_capabilities    | array | Yes      | Capabilities you want to adding   |
| remove_capabilities | array | Yes      | Capabilities you want to removing |

**Capabilities:**
| Name | What it indicates
| :---| :---
| send-message | Ability to send a message
| update-own-message | Ability to update own messages in the channel
| delete-own-message | Ability to delete own messages from the channel
| send-reaction | Ability to send reactions

**5.6. Query Attachments in a channel**
This feature allows users to view all media files shared in a channel, including images, videos, and audio.

```javascript
await channel.queryAttachmentMessages();
```

<br />

### Message management

#### 1. Sending a message

This feature allows user to send a message to a specified channel or DM:

```javascript
await channel.sendMessage({
  text: 'Hello',
  attachments: [],
  quoted_message_id: '',
});
```

| Name              | Type   | Required | Description                                               |
| :---------------- | :----- | :------- | :-------------------------------------------------------- |
| text              | string | Yes      | Text that you want to send to the selected channel.       |
| attachments       | array  | No       | A list of attachments (audio, videos, images, and files). |
| quoted_message_id | string | No       | The ID of the message that is being quoted.               |

**Attachments Format**

```javascript
const attachments = [
  {
    type: 'image', // Upload file image
    image_url: 'https://bit.ly/2K74TaG',
    title: 'photo.png',
    file_size: 2020,
    mime_type: 'image/png',
  },
  {
    type: 'video', // Upload file video
    asset_url: 'https://bit.ly/2K74TaG',
    file_size: 10000,
    mime_type: 'video/mp4',
    title: 'video name',
    thumb_url: 'https://bit.ly/2Uumxti',
  },
  {
    type: 'file', // Upload another file
    asset_url: 'https://bit.ly/3Agxsrt',
    file_size: 2000,
    mime_type: 'application/msword',
    title: 'file name',
  },
];
```

#### 2. Upload file

This feature allows user to upload a file to the system. Maximum file size is 2GB

```javascript
await channel.sendFile(file);
```

#### 3. Edit message

This feature allows user to edit the content of an existing message:

```javascript
await channel.editMessage(message_id, text);
```

#### 4. Delete message

This feature allows user to delete an existing message:

```javascript
await channel.deleteMessage(message_id);
```

#### 5. Search message

This feature allows user to search for a specific message in a channel of DM:

```javascript
await channel.searchMessage(search_term, offset);
```

| Name        | Type   | Required | Description                                               |
| :---------- | :----- | :------- | :-------------------------------------------------------- |
| search_term | string | Yes      | Keyword used to filter the messages.                      |
| offset      | string | Yes      | Starting position for retrieving search data in the list. |

#### 6. Unread messages

The Unread Message Count indicates how many messages were received wwhile a user was offline. After reconnecting or logging in, user can view the total number of missed messages in a channel or DM.

**Get unread messages count (all channels)**
`getUnreadCount()` returns information on all unread messages across all joined channels. You can display this number in the UI within the channel list of your chat app.

```javascript
await chatClient.getUnreadCount(userId);
```

**Marking a channel as read**
You can mark all messages in a channel as read on the client-side:

```javascript
await channel.markRead();
```

**Jump to last read message**
This is how you can jump to the last read message in a specific channel:

```javascript
const channel = chatClient.channel(channel_type, channel_id);
await channel.query();

const lastReadMessageId = channel.state.read['<user id>'];
await channel.state.loadMessageIntoState(lastReadMessageId);

console.log(channel.state.messages);
```

#### 7. Reactions

The Reaction feature allows users to send, manage reactions on messages, and delete reactions when necessary.

**Send a reaction:**

```javascript
await channel.sendReaction(message_id, reaction_type);
```

**Delete a reaction:**

```javascript
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
