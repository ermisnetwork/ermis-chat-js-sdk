# [ErmisChat](https://ermis.network) Chat SDK for JavaScript

![Platform](https://img.shields.io/badge/platform-JAVASCRIPT-orange.svg)
![Languages](https://img.shields.io/badge/language-TYPESCRIPT-orange.svg)
[![npm](https://img.shields.io/npm/v/ermis-chat-js-sdk.svg?style=popout&colorB=red)](https://www.npmjs.com/package/ermis-chat-js-sdk)

## Table of contents

1.  [Introduction](#introduction)
1.  [Requirements](#requirements)
1.  [Getting started](#getting-started)
1.  [Sending your first message](#sending-your-first-message)

## Introduction

The ErmisChat SDK for JavaScript allows you to add real-time chat into your client app with minimal effort.

## Requirements

This section shows you the prerequisites you need to check for using ErmisChat SDK for JavaScript. If you have any comments or questions regarding bugs and feature requests.

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

The ErmisChat client is setup to allow extension of the base types through use of generics when instantiated. The default instantiation has all generics set to `Record<string, unknown>`.
<br />

## Step by step

### Step 1: Create a API key application from your dashboard

Before installing ErmisChat SDK, you need to create a API key on the [Ermis Dashboard](https://ermis.network). You will need the `Api key` of your Ermis application when initializing the Chat SDK.

> **Note**: Ermis Dashboard coming soon

### Step 2: Install the Chat SDK

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

### Step 3: Install the WalletConnect

You need to install WalletConnect to sign and login to Chat SDK. [WalletConnect docs](https://docs.walletconnect.com/appkit/javascript/core/installation), [Wagmi docs](https://wagmi.sh)

### Step 4: Login to ErmisChat

After install WalletConnect, you need import the ErmisAuth to Initialize.

```javascript
import { WalletConnect } from 'ermis-chat-js-sdk';
const authInstance = WalletConnect.getInstance(API_KEY, address);
```

#### 4.1: Create challenge

Create challenge message before sign wallet.

```javascript
const challenge = await authInstance.startAuth();
```

#### 4.2: Sign wallet and get token

After receiving the challenge message, you need to sign the wallet to get the signature use [useSignTypedData](https://wagmi.sh/react/api/hooks/useSignTypedData), then get token.

```javascript
const response = await authInstance.getAuth(api_key, address, signature);
```

### Step 5: Import the Chat SDk

Client-side you initialize the Chat client with your API key

```javascript
import { ErmisChat } from 'ermis-chat-js-sdk';
const chatClient = ErmisChat.getInstance(API_KEY, {
  timeout: 6000, // optional
  baseURL: BASE_URL, // optional
});
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

<br />

## Sending your first message

Now that the Chat SDK has been imported, we're ready to start sending a message.
Here are the steps to sending your first message using Chat SDK:

### Features:

1. [Users](#users)
1. [Channels](#channels)
1. [Messages](#messages)
1. [Setting channel](#setting-channel)
1. [Events](#events)

### Users

Get users in your project to create direct message.

**1. Query users**

```javascript
await chatClient.queryUsers(project_id, page_size, page);
```

| Name       | Type   | Required | Description                           |
| :--------- | :----- | :------- | :------------------------------------ |
| project_id | string | Yes      | Your project ID                       |
| page       | number | No       | The page number you want to query     |
| page_size  | number | No       | The number of users returned per page |

**2. Search users**

```javascript
await chatClient.searchUsers(page, page_size, name, project_id);
```

| Name       | Type   | Required | Description                           |
| :--------- | :----- | :------- | :------------------------------------ |
| project_id | string | Yes      | Your project ID                       |
| page       | number | No       | The page number you want to query     |
| page_size  | number | No       | The number of users returned per page |
| name       | string | Yes      | User name you want to query           |

**3. Get users by userIds**

```javascript
await chatClient.getBatchUsers(users, page, page_size, project_id);
```

| Name       | Type   | Required | Description                           |
| :--------- | :----- | :------- | :------------------------------------ |
| project_id | string | Yes      | Your project ID                       |
| page       | number | No       | The page number you want to query     |
| page_size  | number | No       | The number of users returned per page |
| users      | array  | Yes      | List user id you want to query        |

**4. Get user by user id**

```javascript
await chatClient.queryUser(user_id);
```

**5. Update profile**

```javascript
await chatClient.updateProfile(name, about_me);
```

| Name     | Type   | Required | Description      |
| :------- | :----- | :------- | :--------------- |
| name     | string | Yes      | Your user name   |
| about_me | string | No       | Your description |

**6. Get contact**

Your contact in project

```javascript
await chatClient.queryContacts(PROJECT_ID);
```

<br />

### Channels

**1. Query channels**

Get channels in your project. Here’s an example of how you can query the list of channels:

```javascript
const filter = {
  project_id: PROJECT_ID,
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

Type is object. The query filters to use. You can query on any of the custom fields you've defined on the Channel.
| Name | Type | Required | Description |
| :-----------| :-- | :---------| :-----------|
| project_id | string | Yes | Your project ID
| type | array | No | The type of channel: messaging, team. Array is empty will get all channels.
| roles | array | No | This method is used to retrieve a list of channels that the current user is a part of. The API supports filtering channels based on the user's role within each channel, including roles such as `owner`, `moder`, `member`, and `pending`.<br /><br />`owner` - Retrieves a list of channels where the user's role is the owner. <br />`moder` - Retrieves a list of channels where the user's role is the moderator. <br />`member` - Retrieves a list of channels where the user's role is a member. <br /> `pending` - Retrieves a list of channels where the user's role is pending approval.
| other_roles | array | No | This API allows you to retrieve a list of channels that you have created, with the ability to filter channels based on the roles of other users within the channel. The roles available for filtering include: `owner`, `moder`, `member`, and `pending`.<br /><br /> `owner` - Filter channels where the user is the channel owner.</br> `moder` - Filter channels where the user is a moderator.</br> `member` - Filter channels where the user is a member. </br> `pending` - Filter channels where the user is pending approval.
| limit | integer | No | The maximum number of channels to retrieve in a single request.
| offset | integer | No | The starting position for data retrieval. This parameter allows you to retrieve channels starting from a specific position, useful for paginating through results. For example, offset: 30 will start retrieving channels from position 31 in the list.

**Sort:**

Type is object or array of objects. The sorting used for the channels matching the filters. Sorting is based on field and direction, multiple sorting options can be provided. You can sort based on `last_message_at`. Direction can be ascending (1) or descending (-1).

```javascript
const sort = [{ last_message_at: -1 }];
```

**Options:**

Type is object. This method can be used to fetch information about existing channels, including message counts, and other related details.
| Name | Type | Required | Description |
| :-----------| :--- | :---------| :-----------|
| message_limit | integer | No | The maximum number of messages to retrieve from each channel. If this parameter is not provided, the default number of messages or no limit will be applied.

```javascript
const options = { message_limit: 25 };
```

**2. Create new channel**

Create a channel: choose Direct for 1-1 (messaging) or Group (team) for multiple users.

**New direct message:**

```javascript
// channel type is messaging
const channel = await chatClient.channel('messaging', {
  members: [userId, myUserId],
});
await channel.create({ project_id: PROJECT_ID });
```

**New group:**

```javascript
// channel type is team
const channel = await chatClient.channel('team', {
  name: channel_name,
  members: [user_ids],
});
await channel.create({ project_id: PROJECT_ID });
```

**3. Accept/Reject invite**

**Accept:**

```javascript
// initialize the channel
const channel = chatClient.channel(channel_type, channel_id);

// accept the invite
await channel.acceptInvite();
```

**Reject:**

```javascript
// initialize the channel
const channel = chatClient.channel(channel_type, channel_id);

// accept the invite
await channel.rejectInvite();
```

**4. Query a Channel**

Qeries the channel state and returns members, watchers and messages

```javascript
const channel = chatClient.channel(channel_type, channel_id);
await channel.query({ project_id: PROJECT_ID });
```

You can use conditional parameters to filter messages based on their message id.
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
  project_id: PROJECT_ID,
  messages, // optional
});
```

<br />

### Messages

**1. Send message**

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
| quoted_message_id | string | No       | Message id to a message when you quote another message.   |

**Attachmens format**

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

**2. Upload file**

```javascript
await channel.sendFile(file);
```

**3. Edit message**

```javascript
await channel.editMessage(message_id, text);
```

**4. Delete message**

```javascript
await channel.deleteMessage(message_id);
```

**5. Search message**

```javascript
await channel.searchMessage(search_term, offset);
```

| Name        | Type   | Required | Description                                               |
| :---------- | :----- | :------- | :-------------------------------------------------------- |
| search_term | string | Yes      | Keyword used to filter the messages.                      |
| offset      | string | Yes      | Starting position for retrieving search data in the list. |

**5. Unread messages**
The Unread Message Count feature shows users how many messages they missed while offline. Once they reconnect or log into the app again, they can get the number of messages published in a given channel while they were gone.

**Get unread messages count (all channels)**
`getUnreadCount()` returns info on all messages you didn't read on all joined channels. You can display this number on UI in the channel list of your chat app.

```javascript
await chatClient.getUnreadCount(userId);
```

**Marking a channel as read**
You can mark all messages in a channel as read like this on the client-side:

```javascript
await channel.markRead();
```

**Jump to last read message**
This is how you can jump to the last read message inside a given channel:

```javascript
const channel = chatClient.channel(channel_type, channel_id);
await channel.query({ project_id: PROJECT_ID });

const lastReadMessageId = channel.state.read['<user id>'];
await channel.state.loadMessageIntoState(lastReadMessageId);

console.log(channel.state.messages);
```

**6. Reactions**
The Reaction feature allows users to send, manage reactions on messages, and delete reactions when necessary.

**Send reaction:**

```javascript
await channel.sendReaction(message_id, reaction_type);
```

**Delete reaction:**

```javascript
await channel.deleteReaction(message_id, reaction_type);
```

| Name          | Type   | Required | Description                                                                    |
| :------------ | :----- | :------- | :----------------------------------------------------------------------------- |
| message_id    | string | Yes      | ID of the message to react to                                                  |
| reaction_type | string | Yes      | Type of the reaction. User could have only 1 reaction of each type per message |

**7. Typing Indicators**
Typing indicators allow you to show to users who is currently typing in the channel.

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

### Setting channel

The channel settings feature allows users to customize channel attributes such as name, description, membership permissions, and notification settings to suit their communication needs.

**1. Edit channel (name, avatar, description)**

```javascript
const payload = { name, image, description };

await channel.update(payload);
```

| Name        | Type   | Required | Description                  |
| :---------- | :----- | :------- | :--------------------------- |
| name        | string | Yes      | Display name for the channel |
| image       | string | No       | Avatar for the channel       |
| description | string | No       | Description for the channel  |

**2. Adding & Removing Channel Members**
Using the addMembers() method adds the given users as members, while removeMembers() removes them.

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

**3. Adding & Removing Moderators to a Channel**
Using the addModerators() method adds the given users as moderators (or updates their role to moderator if already members), while demoteModerators() removes the moderator status.

**Adding moderators**

```javascript
await channel.addModerators(userIds);
```

**Removing moderators**

```javascript
await channel.demoteModerators(userIds);
```

| Name    | Type  | Required | Description                                 |
| :------ | :---- | :------- | :------------------------------------------ |
| userIds | array | Yes      | List user id you want to adding or removing |

**4. Ban & Unban Channel Members**
The ban and unban feature allows administrators to block or unblock members with the "member" role in the chat room, controlling their access rights.

**Ban:**

```javascript
await channel.banMembers(userIds);
```

**Unban**

```javascript
await channel.unbanMembers(userIds);
```

| Name    | Type  | Required | Description                           |
| :------ | :---- | :------- | :------------------------------------ |
| userIds | array | Yes      | List user id you want to ban or unban |

**5. Channel Capabilities**
A feature that allows owner to configure permissions for members with the "member" role to send, edit, delete, and react to messages, ensuring chat content control.

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

**6. Query Attachments in channel**
The media message display feature allows users to view media files such as images, videos, and audio within the chat, enhancing the interaction experience without needing to send content.

```javascript
await channel.queryAttachmentMessages();
```

<br />

### Events

Events allow the client to stay up to date with changes to the chat. Examples are a new message, a reaction, or a member joining the channel.
A full list of events is shown below. The next section of the documentation explains how to listen for events.
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

**1. Listening for Events**:
As soon as you call watch on a Channel or queryChannels you’ll start to listen to these events. You can hook into specific events:

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

**2. Client Events**:
Not all events are specific to channels. Events such as the user's status has changed, the users' unread count has changed, and other notifications are sent as client events. These events can be listened to through the client directly:

```javascript
chatClient.on((event) => {
  console.log('event', event);
});
```

**3. Stop Listening for Events**:
It is a good practice to unregister event handlers once they are not in use anymore. Doing so will save you from performance degradations coming from memory leaks or even from errors and exceptions (i.e. null pointer exceptions)

```javascript
// remove the handler from all client events
// const myClientEventListener = client.on('connection.changed', myClientEventHandler)
myClientEventListener.unsubscribe();

// remove the handler from all events on a channel
// const myChannelEventListener = channel.on('connection.changed', myChannelEventHandler)
myChannelEventListener.unsubscribe();
```
