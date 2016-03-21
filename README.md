# tera-proxy-game

Hosts a TCP proxy server to read, modify, and inject network data between a TERA game client and server.
Modular system built on event-based hooks allows for easy creation and usage of script mods.

## Example
```coffeescript
GameProxy = require 'game'

server = GameProxy.createServer { host: '208.67.49.92', port: 10001 },
  (dispatch) -> dispatch.load 'logger'

server.listen 9247, '127.0.0.1', ->
  address = server.address()
  console.log 'listening on %s:%d', address.address, address.port
```

## Building a Module

A module loaded through `dispatch.load(name)` is instantiated similarly to:

```coffeescript
module = require name
modules[name] = new module dispatch
```

Thus, a loadable module's export must be a function. Since this function is called with `new`,
the context of `this` will be unique to each connection to the proxy.

As an example of a simple module, we can set up a hook on `sSpawnUser` to turn everyone else into an elin:

```coffeescript
module.exports = (dispatch) ->
  # set up a pre hook
  dispatch.hook 'sSpawnUser', (event) ->
    # calculate the user's class from the model
    job = (event.model - 10101) % 100
    
    # if the user is a gunner (9) or brawler (10),
    if job > 8
      # don't do anything
      return

    # calculate the user's race from the model
    race = (event.model - 10101) // 100
    
    # modify the model 
    event.model += (9 - race) * 100
    
    # return
    true # marks the event object as having changed
```

For a slightly more complex example, we can make a module that replaces the string `{me}` in
chat messages with the name of the character being played.

```coffeescript
# export a class rather than a simple function as an example
module.exports = class Me
  # set up hooks in the constructor
  constructor: (dispatch) ->
    # initialize properties
    @name = ''

    # hook sLogin to save character name
    dispatch.hook 'sLogin', @onLogin.bind @
    
    # hook cChat and cWhisper to replace "{me}"
    dispatch.hook 'cChat', @onChat.bind @
    dispatch.hook 'cWhisper', @onChat.bind @

  # method used as event handler for sLogin
  onLogin: (event) ->
    # save character name
    @name = event.name

    # explicit return ensures that this hook will not cause the message to be
    # dropped or reconstructed
    return

  # method used as event handler for cChat and cWhisper
  onChat: (event) ->
    # replace {me} with the name of our character (from object property)
    message = event.message.replace /\{me\}/g, @name
    
    # if the message changed,
    if message isnt event.message
      # save the new value in the event object
      event.message = message

      # return value of true will flag the event object as modified
      true # this will cause the message to be reconstructed
```

## The Protocol

The `def/` directory holds all the definitions for messages, including a mapping of message names to opcodes in `_map.def`.
Generally, `_map.def` will need to be updated on every major version bump of TERA. One method of easily accomplishing this
is written in [GoneUp's Tera Packet Viewer](https://github.com/GoneUp/Tera_PacketViewer/blob/Dev/Opcode%20DLL/README.txt).
Note that the official message names are converted to camel case, e.g., `S_SPAWN_USER` becomes `sSpawnUser` here.

All other `.def` files must be named after a message and contain a list of field type and name information. This is used
to both parse the raw network data into a JavaScript object and convert said object back into a buffer. As an example from
`sGuildHistory`:

```
count  events
offset events

int32 page
int32 pages
array events
- offset initiator
- offset description
- int64  date
- int32  event
- string initiator
- string description
```

A line must consist of:
 * An optional series of `-` for array definitions. These may be separated by spaces.
   To nest arrays, just add one more `-` to the front.
 * A field type. Valid types listed below.
 * At least one space.
 * A field name to be used for the resulting JavaScript object.

A `#` and anything after it on the line are comments and will be ignored when parsing.

The following field types are supported:

 * `array`: Converts to a JavaScript array. Both `count` and `offset` metatypes are required for this field.
   This implicitly includes an `offset here` and an `offset next` at the beginning of each array item.
 * `byte`: A single byte. Also used for booleans.
 * `bytes`: Converts to a [Node `Buffer`](https://nodejs.org/api/buffer.html).
   Both `count` and `offset` metatypes are required for this field.
 * `count`, `offset`: Synonymous with `uint16`. `count` dictates the length of an `array` or `bytes` field, while
   `offset` indicates the byte offset from the beginning of the message for `array`, `bytes`, and `string`.
 * `int16`, `uint16`, `int32`, `uint32`, `float`: Self-explanatory.
 * `int64`, `uint64`: Converts to an `Int64` object; see below.
 * `string`: Reads a sequence of `uint16`, ending when `NUL` (`0x0000`) is encountered. Converts to a normal JavaScript string.
   `offset` is required for this field.

Since JavaScript only supports numbers to 53 bits of precision, an `Int64` object must be used for 64-bit integers.
It contains the properties `low` and `high` as well as an `equals()` method to compare against other `Int64`s.

## API Reference

### `Dispatch`

An instance of `Dispatch` is created for every connection to the proxy game server.

 * `hook(name, [type], cb)`
 * `unhook(name, [type], cb)`

Adds or removes a hook for a message.

`name` will usually be the name of the message being watched for, but it can also be `"*"` to catch all messages.
If `"*"` is used, then `type` is forced to `"raw"`.

`type` defaults to `"pre"` for a pre-hook, which will pass the parsed message data as an argument to `cb`.
`type` can also be `"raw"`, in which case a `Buffer` containing the raw message data will be passed instead.
If `name` is `"*"`, this will always be `"raw"`.

`cb` receives:
 * For a `pre` hook,
   * `event`: The `Object` of the parsed message data.
   * Return value is `true` if `event` is modified, or `false` to stop and silence the message.
     Other return values are ignored.
 * For a `raw` hook,
   * `code`: The opcode of the message as an integer.
   * `data`: The `Buffer` of the raw message data.
   * `fromServer`: `true` if the message was sent by the server, `false` otherwise.
   * Return value is a `Buffer` of the modified message data to use, or `false` to stop and silence the message.
     Other return values are ignored.

When a hooked message is received, `Dispatch` performs the following sequence of actions:

 1. Run all `*` hooks.
    * If a `Buffer` is returned, use it as the new data buffer.
    * If `false` is returned, exit immediately and do not forward the message.
    * Otherwise, keep executing hooks.
 2. Run all `raw` hooks. Return values are interpreted the same as above.
 3. If there are any `pre` hooks, parse the message data into an object and then run all `pre` hooks.
    * If `true` is returned, the hook is signifying that it has modified the event object and
      it will need to be repacked into a `Buffer` when all hooks have been called.
    * If `false` is returned, exit immediately and do not forward the message.
    * Otherwise, keep executing hooks.
 4. Reconstruct the message data if necessary, and forward it to the intended recipient.

Note that if a `pre` hook changes the event object but no `pre` hook returns `true`, the changes will not
be saved because `Dispatch` will not know to reconstruct the message.

 * `toClient(buffer)`
 * `toClient(name, data)`
 * `toServer(buffer)`
 * `toServer(name, data)`

Constructs and sends a packet to either the TERA client or server.

If `buffer` is used, it will simply be sent as-is (before encryption).

If `data` is used, `name` must be the message name.

 * `load(name, [from])`

Load the module referenced by `name` using `from.require()`. You will likely want to pass the `module`
from the calling context in order to emulate a `require()` from there; otherwise, it will default to
loading the module as if `require()` were called from inside `dispatch.coffee`. See the
[module.require documentation](https://nodejs.org/api/modules.html#modules_module_require_id) for more
details.

Returns `true` if successful, `false` otherwise.

 * `unload(name)`

Unloads the module referenced by `name`, calling the `destructor()` method on the module if it exists.
This does not automatically remove hooks, which should be done in `destructor()`.

Returns `true` if successful, `false` otherwise.

 * `close()`

Unloads all modules and removes all hooks.
