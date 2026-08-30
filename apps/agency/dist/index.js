#!/usr/bin/env bun
// @bun
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: __accessProp.bind(mod, key),
        enumerable: true
      });
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __require = import.meta.require;

// ../../node_modules/.bun/commander@12.1.0/node_modules/commander/lib/error.js
var require_error = __commonJS((exports) => {
  class CommanderError extends Error {
    constructor(exitCode, code, message) {
      super(message);
      Error.captureStackTrace(this, this.constructor);
      this.name = this.constructor.name;
      this.code = code;
      this.exitCode = exitCode;
      this.nestedError = undefined;
    }
  }

  class InvalidArgumentError extends CommanderError {
    constructor(message) {
      super(1, "commander.invalidArgument", message);
      Error.captureStackTrace(this, this.constructor);
      this.name = this.constructor.name;
    }
  }
  exports.CommanderError = CommanderError;
  exports.InvalidArgumentError = InvalidArgumentError;
});

// ../../node_modules/.bun/commander@12.1.0/node_modules/commander/lib/argument.js
var require_argument = __commonJS((exports) => {
  var { InvalidArgumentError } = require_error();

  class Argument {
    constructor(name, description) {
      this.description = description || "";
      this.variadic = false;
      this.parseArg = undefined;
      this.defaultValue = undefined;
      this.defaultValueDescription = undefined;
      this.argChoices = undefined;
      switch (name[0]) {
        case "<":
          this.required = true;
          this._name = name.slice(1, -1);
          break;
        case "[":
          this.required = false;
          this._name = name.slice(1, -1);
          break;
        default:
          this.required = true;
          this._name = name;
          break;
      }
      if (this._name.length > 3 && this._name.slice(-3) === "...") {
        this.variadic = true;
        this._name = this._name.slice(0, -3);
      }
    }
    name() {
      return this._name;
    }
    _concatValue(value, previous) {
      if (previous === this.defaultValue || !Array.isArray(previous)) {
        return [value];
      }
      return previous.concat(value);
    }
    default(value, description) {
      this.defaultValue = value;
      this.defaultValueDescription = description;
      return this;
    }
    argParser(fn) {
      this.parseArg = fn;
      return this;
    }
    choices(values) {
      this.argChoices = values.slice();
      this.parseArg = (arg, previous) => {
        if (!this.argChoices.includes(arg)) {
          throw new InvalidArgumentError(`Allowed choices are ${this.argChoices.join(", ")}.`);
        }
        if (this.variadic) {
          return this._concatValue(arg, previous);
        }
        return arg;
      };
      return this;
    }
    argRequired() {
      this.required = true;
      return this;
    }
    argOptional() {
      this.required = false;
      return this;
    }
  }
  function humanReadableArgName(arg) {
    const nameOutput = arg.name() + (arg.variadic === true ? "..." : "");
    return arg.required ? "<" + nameOutput + ">" : "[" + nameOutput + "]";
  }
  exports.Argument = Argument;
  exports.humanReadableArgName = humanReadableArgName;
});

// ../../node_modules/.bun/commander@12.1.0/node_modules/commander/lib/help.js
var require_help = __commonJS((exports) => {
  var { humanReadableArgName } = require_argument();

  class Help {
    constructor() {
      this.helpWidth = undefined;
      this.sortSubcommands = false;
      this.sortOptions = false;
      this.showGlobalOptions = false;
    }
    visibleCommands(cmd) {
      const visibleCommands = cmd.commands.filter((cmd2) => !cmd2._hidden);
      const helpCommand = cmd._getHelpCommand();
      if (helpCommand && !helpCommand._hidden) {
        visibleCommands.push(helpCommand);
      }
      if (this.sortSubcommands) {
        visibleCommands.sort((a, b) => {
          return a.name().localeCompare(b.name());
        });
      }
      return visibleCommands;
    }
    compareOptions(a, b) {
      const getSortKey = (option) => {
        return option.short ? option.short.replace(/^-/, "") : option.long.replace(/^--/, "");
      };
      return getSortKey(a).localeCompare(getSortKey(b));
    }
    visibleOptions(cmd) {
      const visibleOptions = cmd.options.filter((option) => !option.hidden);
      const helpOption = cmd._getHelpOption();
      if (helpOption && !helpOption.hidden) {
        const removeShort = helpOption.short && cmd._findOption(helpOption.short);
        const removeLong = helpOption.long && cmd._findOption(helpOption.long);
        if (!removeShort && !removeLong) {
          visibleOptions.push(helpOption);
        } else if (helpOption.long && !removeLong) {
          visibleOptions.push(cmd.createOption(helpOption.long, helpOption.description));
        } else if (helpOption.short && !removeShort) {
          visibleOptions.push(cmd.createOption(helpOption.short, helpOption.description));
        }
      }
      if (this.sortOptions) {
        visibleOptions.sort(this.compareOptions);
      }
      return visibleOptions;
    }
    visibleGlobalOptions(cmd) {
      if (!this.showGlobalOptions)
        return [];
      const globalOptions = [];
      for (let ancestorCmd = cmd.parent;ancestorCmd; ancestorCmd = ancestorCmd.parent) {
        const visibleOptions = ancestorCmd.options.filter((option) => !option.hidden);
        globalOptions.push(...visibleOptions);
      }
      if (this.sortOptions) {
        globalOptions.sort(this.compareOptions);
      }
      return globalOptions;
    }
    visibleArguments(cmd) {
      if (cmd._argsDescription) {
        cmd.registeredArguments.forEach((argument) => {
          argument.description = argument.description || cmd._argsDescription[argument.name()] || "";
        });
      }
      if (cmd.registeredArguments.find((argument) => argument.description)) {
        return cmd.registeredArguments;
      }
      return [];
    }
    subcommandTerm(cmd) {
      const args = cmd.registeredArguments.map((arg) => humanReadableArgName(arg)).join(" ");
      return cmd._name + (cmd._aliases[0] ? "|" + cmd._aliases[0] : "") + (cmd.options.length ? " [options]" : "") + (args ? " " + args : "");
    }
    optionTerm(option) {
      return option.flags;
    }
    argumentTerm(argument) {
      return argument.name();
    }
    longestSubcommandTermLength(cmd, helper) {
      return helper.visibleCommands(cmd).reduce((max, command) => {
        return Math.max(max, helper.subcommandTerm(command).length);
      }, 0);
    }
    longestOptionTermLength(cmd, helper) {
      return helper.visibleOptions(cmd).reduce((max, option) => {
        return Math.max(max, helper.optionTerm(option).length);
      }, 0);
    }
    longestGlobalOptionTermLength(cmd, helper) {
      return helper.visibleGlobalOptions(cmd).reduce((max, option) => {
        return Math.max(max, helper.optionTerm(option).length);
      }, 0);
    }
    longestArgumentTermLength(cmd, helper) {
      return helper.visibleArguments(cmd).reduce((max, argument) => {
        return Math.max(max, helper.argumentTerm(argument).length);
      }, 0);
    }
    commandUsage(cmd) {
      let cmdName = cmd._name;
      if (cmd._aliases[0]) {
        cmdName = cmdName + "|" + cmd._aliases[0];
      }
      let ancestorCmdNames = "";
      for (let ancestorCmd = cmd.parent;ancestorCmd; ancestorCmd = ancestorCmd.parent) {
        ancestorCmdNames = ancestorCmd.name() + " " + ancestorCmdNames;
      }
      return ancestorCmdNames + cmdName + " " + cmd.usage();
    }
    commandDescription(cmd) {
      return cmd.description();
    }
    subcommandDescription(cmd) {
      return cmd.summary() || cmd.description();
    }
    optionDescription(option) {
      const extraInfo = [];
      if (option.argChoices) {
        extraInfo.push(`choices: ${option.argChoices.map((choice) => JSON.stringify(choice)).join(", ")}`);
      }
      if (option.defaultValue !== undefined) {
        const showDefault = option.required || option.optional || option.isBoolean() && typeof option.defaultValue === "boolean";
        if (showDefault) {
          extraInfo.push(`default: ${option.defaultValueDescription || JSON.stringify(option.defaultValue)}`);
        }
      }
      if (option.presetArg !== undefined && option.optional) {
        extraInfo.push(`preset: ${JSON.stringify(option.presetArg)}`);
      }
      if (option.envVar !== undefined) {
        extraInfo.push(`env: ${option.envVar}`);
      }
      if (extraInfo.length > 0) {
        return `${option.description} (${extraInfo.join(", ")})`;
      }
      return option.description;
    }
    argumentDescription(argument) {
      const extraInfo = [];
      if (argument.argChoices) {
        extraInfo.push(`choices: ${argument.argChoices.map((choice) => JSON.stringify(choice)).join(", ")}`);
      }
      if (argument.defaultValue !== undefined) {
        extraInfo.push(`default: ${argument.defaultValueDescription || JSON.stringify(argument.defaultValue)}`);
      }
      if (extraInfo.length > 0) {
        const extraDescripton = `(${extraInfo.join(", ")})`;
        if (argument.description) {
          return `${argument.description} ${extraDescripton}`;
        }
        return extraDescripton;
      }
      return argument.description;
    }
    formatHelp(cmd, helper) {
      const termWidth = helper.padWidth(cmd, helper);
      const helpWidth = helper.helpWidth || 80;
      const itemIndentWidth = 2;
      const itemSeparatorWidth = 2;
      function formatItem(term, description) {
        if (description) {
          const fullText = `${term.padEnd(termWidth + itemSeparatorWidth)}${description}`;
          return helper.wrap(fullText, helpWidth - itemIndentWidth, termWidth + itemSeparatorWidth);
        }
        return term;
      }
      function formatList(textArray) {
        return textArray.join(`
`).replace(/^/gm, " ".repeat(itemIndentWidth));
      }
      let output = [`Usage: ${helper.commandUsage(cmd)}`, ""];
      const commandDescription = helper.commandDescription(cmd);
      if (commandDescription.length > 0) {
        output = output.concat([
          helper.wrap(commandDescription, helpWidth, 0),
          ""
        ]);
      }
      const argumentList = helper.visibleArguments(cmd).map((argument) => {
        return formatItem(helper.argumentTerm(argument), helper.argumentDescription(argument));
      });
      if (argumentList.length > 0) {
        output = output.concat(["Arguments:", formatList(argumentList), ""]);
      }
      const optionList = helper.visibleOptions(cmd).map((option) => {
        return formatItem(helper.optionTerm(option), helper.optionDescription(option));
      });
      if (optionList.length > 0) {
        output = output.concat(["Options:", formatList(optionList), ""]);
      }
      if (this.showGlobalOptions) {
        const globalOptionList = helper.visibleGlobalOptions(cmd).map((option) => {
          return formatItem(helper.optionTerm(option), helper.optionDescription(option));
        });
        if (globalOptionList.length > 0) {
          output = output.concat([
            "Global Options:",
            formatList(globalOptionList),
            ""
          ]);
        }
      }
      const commandList = helper.visibleCommands(cmd).map((cmd2) => {
        return formatItem(helper.subcommandTerm(cmd2), helper.subcommandDescription(cmd2));
      });
      if (commandList.length > 0) {
        output = output.concat(["Commands:", formatList(commandList), ""]);
      }
      return output.join(`
`);
    }
    padWidth(cmd, helper) {
      return Math.max(helper.longestOptionTermLength(cmd, helper), helper.longestGlobalOptionTermLength(cmd, helper), helper.longestSubcommandTermLength(cmd, helper), helper.longestArgumentTermLength(cmd, helper));
    }
    wrap(str, width, indent, minColumnWidth = 40) {
      const indents = " \\f\\t\\v\xA0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF";
      const manualIndent = new RegExp(`[\\n][${indents}]+`);
      if (str.match(manualIndent))
        return str;
      const columnWidth = width - indent;
      if (columnWidth < minColumnWidth)
        return str;
      const leadingStr = str.slice(0, indent);
      const columnText = str.slice(indent).replace(`\r
`, `
`);
      const indentString = " ".repeat(indent);
      const zeroWidthSpace = "\u200B";
      const breaks = `\\s${zeroWidthSpace}`;
      const regex = new RegExp(`
|.{1,${columnWidth - 1}}([${breaks}]|$)|[^${breaks}]+?([${breaks}]|$)`, "g");
      const lines = columnText.match(regex) || [];
      return leadingStr + lines.map((line, i) => {
        if (line === `
`)
          return "";
        return (i > 0 ? indentString : "") + line.trimEnd();
      }).join(`
`);
    }
  }
  exports.Help = Help;
});

// ../../node_modules/.bun/commander@12.1.0/node_modules/commander/lib/option.js
var require_option = __commonJS((exports) => {
  var { InvalidArgumentError } = require_error();

  class Option {
    constructor(flags, description) {
      this.flags = flags;
      this.description = description || "";
      this.required = flags.includes("<");
      this.optional = flags.includes("[");
      this.variadic = /\w\.\.\.[>\]]$/.test(flags);
      this.mandatory = false;
      const optionFlags = splitOptionFlags(flags);
      this.short = optionFlags.shortFlag;
      this.long = optionFlags.longFlag;
      this.negate = false;
      if (this.long) {
        this.negate = this.long.startsWith("--no-");
      }
      this.defaultValue = undefined;
      this.defaultValueDescription = undefined;
      this.presetArg = undefined;
      this.envVar = undefined;
      this.parseArg = undefined;
      this.hidden = false;
      this.argChoices = undefined;
      this.conflictsWith = [];
      this.implied = undefined;
    }
    default(value, description) {
      this.defaultValue = value;
      this.defaultValueDescription = description;
      return this;
    }
    preset(arg) {
      this.presetArg = arg;
      return this;
    }
    conflicts(names) {
      this.conflictsWith = this.conflictsWith.concat(names);
      return this;
    }
    implies(impliedOptionValues) {
      let newImplied = impliedOptionValues;
      if (typeof impliedOptionValues === "string") {
        newImplied = { [impliedOptionValues]: true };
      }
      this.implied = Object.assign(this.implied || {}, newImplied);
      return this;
    }
    env(name) {
      this.envVar = name;
      return this;
    }
    argParser(fn) {
      this.parseArg = fn;
      return this;
    }
    makeOptionMandatory(mandatory = true) {
      this.mandatory = !!mandatory;
      return this;
    }
    hideHelp(hide = true) {
      this.hidden = !!hide;
      return this;
    }
    _concatValue(value, previous) {
      if (previous === this.defaultValue || !Array.isArray(previous)) {
        return [value];
      }
      return previous.concat(value);
    }
    choices(values) {
      this.argChoices = values.slice();
      this.parseArg = (arg, previous) => {
        if (!this.argChoices.includes(arg)) {
          throw new InvalidArgumentError(`Allowed choices are ${this.argChoices.join(", ")}.`);
        }
        if (this.variadic) {
          return this._concatValue(arg, previous);
        }
        return arg;
      };
      return this;
    }
    name() {
      if (this.long) {
        return this.long.replace(/^--/, "");
      }
      return this.short.replace(/^-/, "");
    }
    attributeName() {
      return camelcase(this.name().replace(/^no-/, ""));
    }
    is(arg) {
      return this.short === arg || this.long === arg;
    }
    isBoolean() {
      return !this.required && !this.optional && !this.negate;
    }
  }

  class DualOptions {
    constructor(options) {
      this.positiveOptions = new Map;
      this.negativeOptions = new Map;
      this.dualOptions = new Set;
      options.forEach((option) => {
        if (option.negate) {
          this.negativeOptions.set(option.attributeName(), option);
        } else {
          this.positiveOptions.set(option.attributeName(), option);
        }
      });
      this.negativeOptions.forEach((value, key) => {
        if (this.positiveOptions.has(key)) {
          this.dualOptions.add(key);
        }
      });
    }
    valueFromOption(value, option) {
      const optionKey = option.attributeName();
      if (!this.dualOptions.has(optionKey))
        return true;
      const preset = this.negativeOptions.get(optionKey).presetArg;
      const negativeValue = preset !== undefined ? preset : false;
      return option.negate === (negativeValue === value);
    }
  }
  function camelcase(str) {
    return str.split("-").reduce((str2, word) => {
      return str2 + word[0].toUpperCase() + word.slice(1);
    });
  }
  function splitOptionFlags(flags) {
    let shortFlag;
    let longFlag;
    const flagParts = flags.split(/[ |,]+/);
    if (flagParts.length > 1 && !/^[[<]/.test(flagParts[1]))
      shortFlag = flagParts.shift();
    longFlag = flagParts.shift();
    if (!shortFlag && /^-[^-]$/.test(longFlag)) {
      shortFlag = longFlag;
      longFlag = undefined;
    }
    return { shortFlag, longFlag };
  }
  exports.Option = Option;
  exports.DualOptions = DualOptions;
});

// ../../node_modules/.bun/commander@12.1.0/node_modules/commander/lib/suggestSimilar.js
var require_suggestSimilar = __commonJS((exports) => {
  var maxDistance = 3;
  function editDistance(a, b) {
    if (Math.abs(a.length - b.length) > maxDistance)
      return Math.max(a.length, b.length);
    const d = [];
    for (let i = 0;i <= a.length; i++) {
      d[i] = [i];
    }
    for (let j = 0;j <= b.length; j++) {
      d[0][j] = j;
    }
    for (let j = 1;j <= b.length; j++) {
      for (let i = 1;i <= a.length; i++) {
        let cost = 1;
        if (a[i - 1] === b[j - 1]) {
          cost = 0;
        } else {
          cost = 1;
        }
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
      }
    }
    return d[a.length][b.length];
  }
  function suggestSimilar(word, candidates) {
    if (!candidates || candidates.length === 0)
      return "";
    candidates = Array.from(new Set(candidates));
    const searchingOptions = word.startsWith("--");
    if (searchingOptions) {
      word = word.slice(2);
      candidates = candidates.map((candidate) => candidate.slice(2));
    }
    let similar = [];
    let bestDistance = maxDistance;
    const minSimilarity = 0.4;
    candidates.forEach((candidate) => {
      if (candidate.length <= 1)
        return;
      const distance = editDistance(word, candidate);
      const length = Math.max(word.length, candidate.length);
      const similarity = (length - distance) / length;
      if (similarity > minSimilarity) {
        if (distance < bestDistance) {
          bestDistance = distance;
          similar = [candidate];
        } else if (distance === bestDistance) {
          similar.push(candidate);
        }
      }
    });
    similar.sort((a, b) => a.localeCompare(b));
    if (searchingOptions) {
      similar = similar.map((candidate) => `--${candidate}`);
    }
    if (similar.length > 1) {
      return `
(Did you mean one of ${similar.join(", ")}?)`;
    }
    if (similar.length === 1) {
      return `
(Did you mean ${similar[0]}?)`;
    }
    return "";
  }
  exports.suggestSimilar = suggestSimilar;
});

// ../../node_modules/.bun/commander@12.1.0/node_modules/commander/lib/command.js
var require_command = __commonJS((exports) => {
  var EventEmitter = __require("events").EventEmitter;
  var childProcess = __require("child_process");
  var path = __require("path");
  var fs = __require("fs");
  var process2 = __require("process");
  var { Argument, humanReadableArgName } = require_argument();
  var { CommanderError } = require_error();
  var { Help } = require_help();
  var { Option, DualOptions } = require_option();
  var { suggestSimilar } = require_suggestSimilar();

  class Command extends EventEmitter {
    constructor(name) {
      super();
      this.commands = [];
      this.options = [];
      this.parent = null;
      this._allowUnknownOption = false;
      this._allowExcessArguments = true;
      this.registeredArguments = [];
      this._args = this.registeredArguments;
      this.args = [];
      this.rawArgs = [];
      this.processedArgs = [];
      this._scriptPath = null;
      this._name = name || "";
      this._optionValues = {};
      this._optionValueSources = {};
      this._storeOptionsAsProperties = false;
      this._actionHandler = null;
      this._executableHandler = false;
      this._executableFile = null;
      this._executableDir = null;
      this._defaultCommandName = null;
      this._exitCallback = null;
      this._aliases = [];
      this._combineFlagAndOptionalValue = true;
      this._description = "";
      this._summary = "";
      this._argsDescription = undefined;
      this._enablePositionalOptions = false;
      this._passThroughOptions = false;
      this._lifeCycleHooks = {};
      this._showHelpAfterError = false;
      this._showSuggestionAfterError = true;
      this._outputConfiguration = {
        writeOut: (str) => process2.stdout.write(str),
        writeErr: (str) => process2.stderr.write(str),
        getOutHelpWidth: () => process2.stdout.isTTY ? process2.stdout.columns : undefined,
        getErrHelpWidth: () => process2.stderr.isTTY ? process2.stderr.columns : undefined,
        outputError: (str, write) => write(str)
      };
      this._hidden = false;
      this._helpOption = undefined;
      this._addImplicitHelpCommand = undefined;
      this._helpCommand = undefined;
      this._helpConfiguration = {};
    }
    copyInheritedSettings(sourceCommand) {
      this._outputConfiguration = sourceCommand._outputConfiguration;
      this._helpOption = sourceCommand._helpOption;
      this._helpCommand = sourceCommand._helpCommand;
      this._helpConfiguration = sourceCommand._helpConfiguration;
      this._exitCallback = sourceCommand._exitCallback;
      this._storeOptionsAsProperties = sourceCommand._storeOptionsAsProperties;
      this._combineFlagAndOptionalValue = sourceCommand._combineFlagAndOptionalValue;
      this._allowExcessArguments = sourceCommand._allowExcessArguments;
      this._enablePositionalOptions = sourceCommand._enablePositionalOptions;
      this._showHelpAfterError = sourceCommand._showHelpAfterError;
      this._showSuggestionAfterError = sourceCommand._showSuggestionAfterError;
      return this;
    }
    _getCommandAndAncestors() {
      const result = [];
      for (let command = this;command; command = command.parent) {
        result.push(command);
      }
      return result;
    }
    command(nameAndArgs, actionOptsOrExecDesc, execOpts) {
      let desc = actionOptsOrExecDesc;
      let opts = execOpts;
      if (typeof desc === "object" && desc !== null) {
        opts = desc;
        desc = null;
      }
      opts = opts || {};
      const [, name, args] = nameAndArgs.match(/([^ ]+) *(.*)/);
      const cmd = this.createCommand(name);
      if (desc) {
        cmd.description(desc);
        cmd._executableHandler = true;
      }
      if (opts.isDefault)
        this._defaultCommandName = cmd._name;
      cmd._hidden = !!(opts.noHelp || opts.hidden);
      cmd._executableFile = opts.executableFile || null;
      if (args)
        cmd.arguments(args);
      this._registerCommand(cmd);
      cmd.parent = this;
      cmd.copyInheritedSettings(this);
      if (desc)
        return this;
      return cmd;
    }
    createCommand(name) {
      return new Command(name);
    }
    createHelp() {
      return Object.assign(new Help, this.configureHelp());
    }
    configureHelp(configuration) {
      if (configuration === undefined)
        return this._helpConfiguration;
      this._helpConfiguration = configuration;
      return this;
    }
    configureOutput(configuration) {
      if (configuration === undefined)
        return this._outputConfiguration;
      Object.assign(this._outputConfiguration, configuration);
      return this;
    }
    showHelpAfterError(displayHelp = true) {
      if (typeof displayHelp !== "string")
        displayHelp = !!displayHelp;
      this._showHelpAfterError = displayHelp;
      return this;
    }
    showSuggestionAfterError(displaySuggestion = true) {
      this._showSuggestionAfterError = !!displaySuggestion;
      return this;
    }
    addCommand(cmd, opts) {
      if (!cmd._name) {
        throw new Error(`Command passed to .addCommand() must have a name
- specify the name in Command constructor or using .name()`);
      }
      opts = opts || {};
      if (opts.isDefault)
        this._defaultCommandName = cmd._name;
      if (opts.noHelp || opts.hidden)
        cmd._hidden = true;
      this._registerCommand(cmd);
      cmd.parent = this;
      cmd._checkForBrokenPassThrough();
      return this;
    }
    createArgument(name, description) {
      return new Argument(name, description);
    }
    argument(name, description, fn, defaultValue) {
      const argument = this.createArgument(name, description);
      if (typeof fn === "function") {
        argument.default(defaultValue).argParser(fn);
      } else {
        argument.default(fn);
      }
      this.addArgument(argument);
      return this;
    }
    arguments(names) {
      names.trim().split(/ +/).forEach((detail) => {
        this.argument(detail);
      });
      return this;
    }
    addArgument(argument) {
      const previousArgument = this.registeredArguments.slice(-1)[0];
      if (previousArgument && previousArgument.variadic) {
        throw new Error(`only the last argument can be variadic '${previousArgument.name()}'`);
      }
      if (argument.required && argument.defaultValue !== undefined && argument.parseArg === undefined) {
        throw new Error(`a default value for a required argument is never used: '${argument.name()}'`);
      }
      this.registeredArguments.push(argument);
      return this;
    }
    helpCommand(enableOrNameAndArgs, description) {
      if (typeof enableOrNameAndArgs === "boolean") {
        this._addImplicitHelpCommand = enableOrNameAndArgs;
        return this;
      }
      enableOrNameAndArgs = enableOrNameAndArgs ?? "help [command]";
      const [, helpName, helpArgs] = enableOrNameAndArgs.match(/([^ ]+) *(.*)/);
      const helpDescription = description ?? "display help for command";
      const helpCommand = this.createCommand(helpName);
      helpCommand.helpOption(false);
      if (helpArgs)
        helpCommand.arguments(helpArgs);
      if (helpDescription)
        helpCommand.description(helpDescription);
      this._addImplicitHelpCommand = true;
      this._helpCommand = helpCommand;
      return this;
    }
    addHelpCommand(helpCommand, deprecatedDescription) {
      if (typeof helpCommand !== "object") {
        this.helpCommand(helpCommand, deprecatedDescription);
        return this;
      }
      this._addImplicitHelpCommand = true;
      this._helpCommand = helpCommand;
      return this;
    }
    _getHelpCommand() {
      const hasImplicitHelpCommand = this._addImplicitHelpCommand ?? (this.commands.length && !this._actionHandler && !this._findCommand("help"));
      if (hasImplicitHelpCommand) {
        if (this._helpCommand === undefined) {
          this.helpCommand(undefined, undefined);
        }
        return this._helpCommand;
      }
      return null;
    }
    hook(event, listener) {
      const allowedValues = ["preSubcommand", "preAction", "postAction"];
      if (!allowedValues.includes(event)) {
        throw new Error(`Unexpected value for event passed to hook : '${event}'.
Expecting one of '${allowedValues.join("', '")}'`);
      }
      if (this._lifeCycleHooks[event]) {
        this._lifeCycleHooks[event].push(listener);
      } else {
        this._lifeCycleHooks[event] = [listener];
      }
      return this;
    }
    exitOverride(fn) {
      if (fn) {
        this._exitCallback = fn;
      } else {
        this._exitCallback = (err) => {
          if (err.code !== "commander.executeSubCommandAsync") {
            throw err;
          }
        };
      }
      return this;
    }
    _exit(exitCode, code, message) {
      if (this._exitCallback) {
        this._exitCallback(new CommanderError(exitCode, code, message));
      }
      process2.exit(exitCode);
    }
    action(fn) {
      const listener = (args) => {
        const expectedArgsCount = this.registeredArguments.length;
        const actionArgs = args.slice(0, expectedArgsCount);
        if (this._storeOptionsAsProperties) {
          actionArgs[expectedArgsCount] = this;
        } else {
          actionArgs[expectedArgsCount] = this.opts();
        }
        actionArgs.push(this);
        return fn.apply(this, actionArgs);
      };
      this._actionHandler = listener;
      return this;
    }
    createOption(flags, description) {
      return new Option(flags, description);
    }
    _callParseArg(target, value, previous, invalidArgumentMessage) {
      try {
        return target.parseArg(value, previous);
      } catch (err) {
        if (err.code === "commander.invalidArgument") {
          const message = `${invalidArgumentMessage} ${err.message}`;
          this.error(message, { exitCode: err.exitCode, code: err.code });
        }
        throw err;
      }
    }
    _registerOption(option) {
      const matchingOption = option.short && this._findOption(option.short) || option.long && this._findOption(option.long);
      if (matchingOption) {
        const matchingFlag = option.long && this._findOption(option.long) ? option.long : option.short;
        throw new Error(`Cannot add option '${option.flags}'${this._name && ` to command '${this._name}'`} due to conflicting flag '${matchingFlag}'
-  already used by option '${matchingOption.flags}'`);
      }
      this.options.push(option);
    }
    _registerCommand(command) {
      const knownBy = (cmd) => {
        return [cmd.name()].concat(cmd.aliases());
      };
      const alreadyUsed = knownBy(command).find((name) => this._findCommand(name));
      if (alreadyUsed) {
        const existingCmd = knownBy(this._findCommand(alreadyUsed)).join("|");
        const newCmd = knownBy(command).join("|");
        throw new Error(`cannot add command '${newCmd}' as already have command '${existingCmd}'`);
      }
      this.commands.push(command);
    }
    addOption(option) {
      this._registerOption(option);
      const oname = option.name();
      const name = option.attributeName();
      if (option.negate) {
        const positiveLongFlag = option.long.replace(/^--no-/, "--");
        if (!this._findOption(positiveLongFlag)) {
          this.setOptionValueWithSource(name, option.defaultValue === undefined ? true : option.defaultValue, "default");
        }
      } else if (option.defaultValue !== undefined) {
        this.setOptionValueWithSource(name, option.defaultValue, "default");
      }
      const handleOptionValue = (val, invalidValueMessage, valueSource) => {
        if (val == null && option.presetArg !== undefined) {
          val = option.presetArg;
        }
        const oldValue = this.getOptionValue(name);
        if (val !== null && option.parseArg) {
          val = this._callParseArg(option, val, oldValue, invalidValueMessage);
        } else if (val !== null && option.variadic) {
          val = option._concatValue(val, oldValue);
        }
        if (val == null) {
          if (option.negate) {
            val = false;
          } else if (option.isBoolean() || option.optional) {
            val = true;
          } else {
            val = "";
          }
        }
        this.setOptionValueWithSource(name, val, valueSource);
      };
      this.on("option:" + oname, (val) => {
        const invalidValueMessage = `error: option '${option.flags}' argument '${val}' is invalid.`;
        handleOptionValue(val, invalidValueMessage, "cli");
      });
      if (option.envVar) {
        this.on("optionEnv:" + oname, (val) => {
          const invalidValueMessage = `error: option '${option.flags}' value '${val}' from env '${option.envVar}' is invalid.`;
          handleOptionValue(val, invalidValueMessage, "env");
        });
      }
      return this;
    }
    _optionEx(config, flags, description, fn, defaultValue) {
      if (typeof flags === "object" && flags instanceof Option) {
        throw new Error("To add an Option object use addOption() instead of option() or requiredOption()");
      }
      const option = this.createOption(flags, description);
      option.makeOptionMandatory(!!config.mandatory);
      if (typeof fn === "function") {
        option.default(defaultValue).argParser(fn);
      } else if (fn instanceof RegExp) {
        const regex = fn;
        fn = (val, def) => {
          const m = regex.exec(val);
          return m ? m[0] : def;
        };
        option.default(defaultValue).argParser(fn);
      } else {
        option.default(fn);
      }
      return this.addOption(option);
    }
    option(flags, description, parseArg, defaultValue) {
      return this._optionEx({}, flags, description, parseArg, defaultValue);
    }
    requiredOption(flags, description, parseArg, defaultValue) {
      return this._optionEx({ mandatory: true }, flags, description, parseArg, defaultValue);
    }
    combineFlagAndOptionalValue(combine = true) {
      this._combineFlagAndOptionalValue = !!combine;
      return this;
    }
    allowUnknownOption(allowUnknown = true) {
      this._allowUnknownOption = !!allowUnknown;
      return this;
    }
    allowExcessArguments(allowExcess = true) {
      this._allowExcessArguments = !!allowExcess;
      return this;
    }
    enablePositionalOptions(positional = true) {
      this._enablePositionalOptions = !!positional;
      return this;
    }
    passThroughOptions(passThrough = true) {
      this._passThroughOptions = !!passThrough;
      this._checkForBrokenPassThrough();
      return this;
    }
    _checkForBrokenPassThrough() {
      if (this.parent && this._passThroughOptions && !this.parent._enablePositionalOptions) {
        throw new Error(`passThroughOptions cannot be used for '${this._name}' without turning on enablePositionalOptions for parent command(s)`);
      }
    }
    storeOptionsAsProperties(storeAsProperties = true) {
      if (this.options.length) {
        throw new Error("call .storeOptionsAsProperties() before adding options");
      }
      if (Object.keys(this._optionValues).length) {
        throw new Error("call .storeOptionsAsProperties() before setting option values");
      }
      this._storeOptionsAsProperties = !!storeAsProperties;
      return this;
    }
    getOptionValue(key) {
      if (this._storeOptionsAsProperties) {
        return this[key];
      }
      return this._optionValues[key];
    }
    setOptionValue(key, value) {
      return this.setOptionValueWithSource(key, value, undefined);
    }
    setOptionValueWithSource(key, value, source) {
      if (this._storeOptionsAsProperties) {
        this[key] = value;
      } else {
        this._optionValues[key] = value;
      }
      this._optionValueSources[key] = source;
      return this;
    }
    getOptionValueSource(key) {
      return this._optionValueSources[key];
    }
    getOptionValueSourceWithGlobals(key) {
      let source;
      this._getCommandAndAncestors().forEach((cmd) => {
        if (cmd.getOptionValueSource(key) !== undefined) {
          source = cmd.getOptionValueSource(key);
        }
      });
      return source;
    }
    _prepareUserArgs(argv, parseOptions) {
      if (argv !== undefined && !Array.isArray(argv)) {
        throw new Error("first parameter to parse must be array or undefined");
      }
      parseOptions = parseOptions || {};
      if (argv === undefined && parseOptions.from === undefined) {
        if (process2.versions?.electron) {
          parseOptions.from = "electron";
        }
        const execArgv = process2.execArgv ?? [];
        if (execArgv.includes("-e") || execArgv.includes("--eval") || execArgv.includes("-p") || execArgv.includes("--print")) {
          parseOptions.from = "eval";
        }
      }
      if (argv === undefined) {
        argv = process2.argv;
      }
      this.rawArgs = argv.slice();
      let userArgs;
      switch (parseOptions.from) {
        case undefined:
        case "node":
          this._scriptPath = argv[1];
          userArgs = argv.slice(2);
          break;
        case "electron":
          if (process2.defaultApp) {
            this._scriptPath = argv[1];
            userArgs = argv.slice(2);
          } else {
            userArgs = argv.slice(1);
          }
          break;
        case "user":
          userArgs = argv.slice(0);
          break;
        case "eval":
          userArgs = argv.slice(1);
          break;
        default:
          throw new Error(`unexpected parse option { from: '${parseOptions.from}' }`);
      }
      if (!this._name && this._scriptPath)
        this.nameFromFilename(this._scriptPath);
      this._name = this._name || "program";
      return userArgs;
    }
    parse(argv, parseOptions) {
      const userArgs = this._prepareUserArgs(argv, parseOptions);
      this._parseCommand([], userArgs);
      return this;
    }
    async parseAsync(argv, parseOptions) {
      const userArgs = this._prepareUserArgs(argv, parseOptions);
      await this._parseCommand([], userArgs);
      return this;
    }
    _executeSubCommand(subcommand, args) {
      args = args.slice();
      let launchWithNode = false;
      const sourceExt = [".js", ".ts", ".tsx", ".mjs", ".cjs"];
      function findFile(baseDir, baseName) {
        const localBin = path.resolve(baseDir, baseName);
        if (fs.existsSync(localBin))
          return localBin;
        if (sourceExt.includes(path.extname(baseName)))
          return;
        const foundExt = sourceExt.find((ext) => fs.existsSync(`${localBin}${ext}`));
        if (foundExt)
          return `${localBin}${foundExt}`;
        return;
      }
      this._checkForMissingMandatoryOptions();
      this._checkForConflictingOptions();
      let executableFile = subcommand._executableFile || `${this._name}-${subcommand._name}`;
      let executableDir = this._executableDir || "";
      if (this._scriptPath) {
        let resolvedScriptPath;
        try {
          resolvedScriptPath = fs.realpathSync(this._scriptPath);
        } catch (err) {
          resolvedScriptPath = this._scriptPath;
        }
        executableDir = path.resolve(path.dirname(resolvedScriptPath), executableDir);
      }
      if (executableDir) {
        let localFile = findFile(executableDir, executableFile);
        if (!localFile && !subcommand._executableFile && this._scriptPath) {
          const legacyName = path.basename(this._scriptPath, path.extname(this._scriptPath));
          if (legacyName !== this._name) {
            localFile = findFile(executableDir, `${legacyName}-${subcommand._name}`);
          }
        }
        executableFile = localFile || executableFile;
      }
      launchWithNode = sourceExt.includes(path.extname(executableFile));
      let proc;
      if (process2.platform !== "win32") {
        if (launchWithNode) {
          args.unshift(executableFile);
          args = incrementNodeInspectorPort(process2.execArgv).concat(args);
          proc = childProcess.spawn(process2.argv[0], args, { stdio: "inherit" });
        } else {
          proc = childProcess.spawn(executableFile, args, { stdio: "inherit" });
        }
      } else {
        args.unshift(executableFile);
        args = incrementNodeInspectorPort(process2.execArgv).concat(args);
        proc = childProcess.spawn(process2.execPath, args, { stdio: "inherit" });
      }
      if (!proc.killed) {
        const signals = ["SIGUSR1", "SIGUSR2", "SIGTERM", "SIGINT", "SIGHUP"];
        signals.forEach((signal) => {
          process2.on(signal, () => {
            if (proc.killed === false && proc.exitCode === null) {
              proc.kill(signal);
            }
          });
        });
      }
      const exitCallback = this._exitCallback;
      proc.on("close", (code) => {
        code = code ?? 1;
        if (!exitCallback) {
          process2.exit(code);
        } else {
          exitCallback(new CommanderError(code, "commander.executeSubCommandAsync", "(close)"));
        }
      });
      proc.on("error", (err) => {
        if (err.code === "ENOENT") {
          const executableDirMessage = executableDir ? `searched for local subcommand relative to directory '${executableDir}'` : "no directory for search for local subcommand, use .executableDir() to supply a custom directory";
          const executableMissing = `'${executableFile}' does not exist
 - if '${subcommand._name}' is not meant to be an executable command, remove description parameter from '.command()' and use '.description()' instead
 - if the default executable name is not suitable, use the executableFile option to supply a custom name or path
 - ${executableDirMessage}`;
          throw new Error(executableMissing);
        } else if (err.code === "EACCES") {
          throw new Error(`'${executableFile}' not executable`);
        }
        if (!exitCallback) {
          process2.exit(1);
        } else {
          const wrappedError = new CommanderError(1, "commander.executeSubCommandAsync", "(error)");
          wrappedError.nestedError = err;
          exitCallback(wrappedError);
        }
      });
      this.runningCommand = proc;
    }
    _dispatchSubcommand(commandName, operands, unknown) {
      const subCommand = this._findCommand(commandName);
      if (!subCommand)
        this.help({ error: true });
      let promiseChain;
      promiseChain = this._chainOrCallSubCommandHook(promiseChain, subCommand, "preSubcommand");
      promiseChain = this._chainOrCall(promiseChain, () => {
        if (subCommand._executableHandler) {
          this._executeSubCommand(subCommand, operands.concat(unknown));
        } else {
          return subCommand._parseCommand(operands, unknown);
        }
      });
      return promiseChain;
    }
    _dispatchHelpCommand(subcommandName) {
      if (!subcommandName) {
        this.help();
      }
      const subCommand = this._findCommand(subcommandName);
      if (subCommand && !subCommand._executableHandler) {
        subCommand.help();
      }
      return this._dispatchSubcommand(subcommandName, [], [this._getHelpOption()?.long ?? this._getHelpOption()?.short ?? "--help"]);
    }
    _checkNumberOfArguments() {
      this.registeredArguments.forEach((arg, i) => {
        if (arg.required && this.args[i] == null) {
          this.missingArgument(arg.name());
        }
      });
      if (this.registeredArguments.length > 0 && this.registeredArguments[this.registeredArguments.length - 1].variadic) {
        return;
      }
      if (this.args.length > this.registeredArguments.length) {
        this._excessArguments(this.args);
      }
    }
    _processArguments() {
      const myParseArg = (argument, value, previous) => {
        let parsedValue = value;
        if (value !== null && argument.parseArg) {
          const invalidValueMessage = `error: command-argument value '${value}' is invalid for argument '${argument.name()}'.`;
          parsedValue = this._callParseArg(argument, value, previous, invalidValueMessage);
        }
        return parsedValue;
      };
      this._checkNumberOfArguments();
      const processedArgs = [];
      this.registeredArguments.forEach((declaredArg, index) => {
        let value = declaredArg.defaultValue;
        if (declaredArg.variadic) {
          if (index < this.args.length) {
            value = this.args.slice(index);
            if (declaredArg.parseArg) {
              value = value.reduce((processed, v) => {
                return myParseArg(declaredArg, v, processed);
              }, declaredArg.defaultValue);
            }
          } else if (value === undefined) {
            value = [];
          }
        } else if (index < this.args.length) {
          value = this.args[index];
          if (declaredArg.parseArg) {
            value = myParseArg(declaredArg, value, declaredArg.defaultValue);
          }
        }
        processedArgs[index] = value;
      });
      this.processedArgs = processedArgs;
    }
    _chainOrCall(promise, fn) {
      if (promise && promise.then && typeof promise.then === "function") {
        return promise.then(() => fn());
      }
      return fn();
    }
    _chainOrCallHooks(promise, event) {
      let result = promise;
      const hooks = [];
      this._getCommandAndAncestors().reverse().filter((cmd) => cmd._lifeCycleHooks[event] !== undefined).forEach((hookedCommand) => {
        hookedCommand._lifeCycleHooks[event].forEach((callback) => {
          hooks.push({ hookedCommand, callback });
        });
      });
      if (event === "postAction") {
        hooks.reverse();
      }
      hooks.forEach((hookDetail) => {
        result = this._chainOrCall(result, () => {
          return hookDetail.callback(hookDetail.hookedCommand, this);
        });
      });
      return result;
    }
    _chainOrCallSubCommandHook(promise, subCommand, event) {
      let result = promise;
      if (this._lifeCycleHooks[event] !== undefined) {
        this._lifeCycleHooks[event].forEach((hook) => {
          result = this._chainOrCall(result, () => {
            return hook(this, subCommand);
          });
        });
      }
      return result;
    }
    _parseCommand(operands, unknown) {
      const parsed = this.parseOptions(unknown);
      this._parseOptionsEnv();
      this._parseOptionsImplied();
      operands = operands.concat(parsed.operands);
      unknown = parsed.unknown;
      this.args = operands.concat(unknown);
      if (operands && this._findCommand(operands[0])) {
        return this._dispatchSubcommand(operands[0], operands.slice(1), unknown);
      }
      if (this._getHelpCommand() && operands[0] === this._getHelpCommand().name()) {
        return this._dispatchHelpCommand(operands[1]);
      }
      if (this._defaultCommandName) {
        this._outputHelpIfRequested(unknown);
        return this._dispatchSubcommand(this._defaultCommandName, operands, unknown);
      }
      if (this.commands.length && this.args.length === 0 && !this._actionHandler && !this._defaultCommandName) {
        this.help({ error: true });
      }
      this._outputHelpIfRequested(parsed.unknown);
      this._checkForMissingMandatoryOptions();
      this._checkForConflictingOptions();
      const checkForUnknownOptions = () => {
        if (parsed.unknown.length > 0) {
          this.unknownOption(parsed.unknown[0]);
        }
      };
      const commandEvent = `command:${this.name()}`;
      if (this._actionHandler) {
        checkForUnknownOptions();
        this._processArguments();
        let promiseChain;
        promiseChain = this._chainOrCallHooks(promiseChain, "preAction");
        promiseChain = this._chainOrCall(promiseChain, () => this._actionHandler(this.processedArgs));
        if (this.parent) {
          promiseChain = this._chainOrCall(promiseChain, () => {
            this.parent.emit(commandEvent, operands, unknown);
          });
        }
        promiseChain = this._chainOrCallHooks(promiseChain, "postAction");
        return promiseChain;
      }
      if (this.parent && this.parent.listenerCount(commandEvent)) {
        checkForUnknownOptions();
        this._processArguments();
        this.parent.emit(commandEvent, operands, unknown);
      } else if (operands.length) {
        if (this._findCommand("*")) {
          return this._dispatchSubcommand("*", operands, unknown);
        }
        if (this.listenerCount("command:*")) {
          this.emit("command:*", operands, unknown);
        } else if (this.commands.length) {
          this.unknownCommand();
        } else {
          checkForUnknownOptions();
          this._processArguments();
        }
      } else if (this.commands.length) {
        checkForUnknownOptions();
        this.help({ error: true });
      } else {
        checkForUnknownOptions();
        this._processArguments();
      }
    }
    _findCommand(name) {
      if (!name)
        return;
      return this.commands.find((cmd) => cmd._name === name || cmd._aliases.includes(name));
    }
    _findOption(arg) {
      return this.options.find((option) => option.is(arg));
    }
    _checkForMissingMandatoryOptions() {
      this._getCommandAndAncestors().forEach((cmd) => {
        cmd.options.forEach((anOption) => {
          if (anOption.mandatory && cmd.getOptionValue(anOption.attributeName()) === undefined) {
            cmd.missingMandatoryOptionValue(anOption);
          }
        });
      });
    }
    _checkForConflictingLocalOptions() {
      const definedNonDefaultOptions = this.options.filter((option) => {
        const optionKey = option.attributeName();
        if (this.getOptionValue(optionKey) === undefined) {
          return false;
        }
        return this.getOptionValueSource(optionKey) !== "default";
      });
      const optionsWithConflicting = definedNonDefaultOptions.filter((option) => option.conflictsWith.length > 0);
      optionsWithConflicting.forEach((option) => {
        const conflictingAndDefined = definedNonDefaultOptions.find((defined) => option.conflictsWith.includes(defined.attributeName()));
        if (conflictingAndDefined) {
          this._conflictingOption(option, conflictingAndDefined);
        }
      });
    }
    _checkForConflictingOptions() {
      this._getCommandAndAncestors().forEach((cmd) => {
        cmd._checkForConflictingLocalOptions();
      });
    }
    parseOptions(argv) {
      const operands = [];
      const unknown = [];
      let dest = operands;
      const args = argv.slice();
      function maybeOption(arg) {
        return arg.length > 1 && arg[0] === "-";
      }
      let activeVariadicOption = null;
      while (args.length) {
        const arg = args.shift();
        if (arg === "--") {
          if (dest === unknown)
            dest.push(arg);
          dest.push(...args);
          break;
        }
        if (activeVariadicOption && !maybeOption(arg)) {
          this.emit(`option:${activeVariadicOption.name()}`, arg);
          continue;
        }
        activeVariadicOption = null;
        if (maybeOption(arg)) {
          const option = this._findOption(arg);
          if (option) {
            if (option.required) {
              const value = args.shift();
              if (value === undefined)
                this.optionMissingArgument(option);
              this.emit(`option:${option.name()}`, value);
            } else if (option.optional) {
              let value = null;
              if (args.length > 0 && !maybeOption(args[0])) {
                value = args.shift();
              }
              this.emit(`option:${option.name()}`, value);
            } else {
              this.emit(`option:${option.name()}`);
            }
            activeVariadicOption = option.variadic ? option : null;
            continue;
          }
        }
        if (arg.length > 2 && arg[0] === "-" && arg[1] !== "-") {
          const option = this._findOption(`-${arg[1]}`);
          if (option) {
            if (option.required || option.optional && this._combineFlagAndOptionalValue) {
              this.emit(`option:${option.name()}`, arg.slice(2));
            } else {
              this.emit(`option:${option.name()}`);
              args.unshift(`-${arg.slice(2)}`);
            }
            continue;
          }
        }
        if (/^--[^=]+=/.test(arg)) {
          const index = arg.indexOf("=");
          const option = this._findOption(arg.slice(0, index));
          if (option && (option.required || option.optional)) {
            this.emit(`option:${option.name()}`, arg.slice(index + 1));
            continue;
          }
        }
        if (maybeOption(arg)) {
          dest = unknown;
        }
        if ((this._enablePositionalOptions || this._passThroughOptions) && operands.length === 0 && unknown.length === 0) {
          if (this._findCommand(arg)) {
            operands.push(arg);
            if (args.length > 0)
              unknown.push(...args);
            break;
          } else if (this._getHelpCommand() && arg === this._getHelpCommand().name()) {
            operands.push(arg);
            if (args.length > 0)
              operands.push(...args);
            break;
          } else if (this._defaultCommandName) {
            unknown.push(arg);
            if (args.length > 0)
              unknown.push(...args);
            break;
          }
        }
        if (this._passThroughOptions) {
          dest.push(arg);
          if (args.length > 0)
            dest.push(...args);
          break;
        }
        dest.push(arg);
      }
      return { operands, unknown };
    }
    opts() {
      if (this._storeOptionsAsProperties) {
        const result = {};
        const len = this.options.length;
        for (let i = 0;i < len; i++) {
          const key = this.options[i].attributeName();
          result[key] = key === this._versionOptionName ? this._version : this[key];
        }
        return result;
      }
      return this._optionValues;
    }
    optsWithGlobals() {
      return this._getCommandAndAncestors().reduce((combinedOptions, cmd) => Object.assign(combinedOptions, cmd.opts()), {});
    }
    error(message, errorOptions) {
      this._outputConfiguration.outputError(`${message}
`, this._outputConfiguration.writeErr);
      if (typeof this._showHelpAfterError === "string") {
        this._outputConfiguration.writeErr(`${this._showHelpAfterError}
`);
      } else if (this._showHelpAfterError) {
        this._outputConfiguration.writeErr(`
`);
        this.outputHelp({ error: true });
      }
      const config = errorOptions || {};
      const exitCode = config.exitCode || 1;
      const code = config.code || "commander.error";
      this._exit(exitCode, code, message);
    }
    _parseOptionsEnv() {
      this.options.forEach((option) => {
        if (option.envVar && option.envVar in process2.env) {
          const optionKey = option.attributeName();
          if (this.getOptionValue(optionKey) === undefined || ["default", "config", "env"].includes(this.getOptionValueSource(optionKey))) {
            if (option.required || option.optional) {
              this.emit(`optionEnv:${option.name()}`, process2.env[option.envVar]);
            } else {
              this.emit(`optionEnv:${option.name()}`);
            }
          }
        }
      });
    }
    _parseOptionsImplied() {
      const dualHelper = new DualOptions(this.options);
      const hasCustomOptionValue = (optionKey) => {
        return this.getOptionValue(optionKey) !== undefined && !["default", "implied"].includes(this.getOptionValueSource(optionKey));
      };
      this.options.filter((option) => option.implied !== undefined && hasCustomOptionValue(option.attributeName()) && dualHelper.valueFromOption(this.getOptionValue(option.attributeName()), option)).forEach((option) => {
        Object.keys(option.implied).filter((impliedKey) => !hasCustomOptionValue(impliedKey)).forEach((impliedKey) => {
          this.setOptionValueWithSource(impliedKey, option.implied[impliedKey], "implied");
        });
      });
    }
    missingArgument(name) {
      const message = `error: missing required argument '${name}'`;
      this.error(message, { code: "commander.missingArgument" });
    }
    optionMissingArgument(option) {
      const message = `error: option '${option.flags}' argument missing`;
      this.error(message, { code: "commander.optionMissingArgument" });
    }
    missingMandatoryOptionValue(option) {
      const message = `error: required option '${option.flags}' not specified`;
      this.error(message, { code: "commander.missingMandatoryOptionValue" });
    }
    _conflictingOption(option, conflictingOption) {
      const findBestOptionFromValue = (option2) => {
        const optionKey = option2.attributeName();
        const optionValue = this.getOptionValue(optionKey);
        const negativeOption = this.options.find((target) => target.negate && optionKey === target.attributeName());
        const positiveOption = this.options.find((target) => !target.negate && optionKey === target.attributeName());
        if (negativeOption && (negativeOption.presetArg === undefined && optionValue === false || negativeOption.presetArg !== undefined && optionValue === negativeOption.presetArg)) {
          return negativeOption;
        }
        return positiveOption || option2;
      };
      const getErrorMessage = (option2) => {
        const bestOption = findBestOptionFromValue(option2);
        const optionKey = bestOption.attributeName();
        const source = this.getOptionValueSource(optionKey);
        if (source === "env") {
          return `environment variable '${bestOption.envVar}'`;
        }
        return `option '${bestOption.flags}'`;
      };
      const message = `error: ${getErrorMessage(option)} cannot be used with ${getErrorMessage(conflictingOption)}`;
      this.error(message, { code: "commander.conflictingOption" });
    }
    unknownOption(flag) {
      if (this._allowUnknownOption)
        return;
      let suggestion = "";
      if (flag.startsWith("--") && this._showSuggestionAfterError) {
        let candidateFlags = [];
        let command = this;
        do {
          const moreFlags = command.createHelp().visibleOptions(command).filter((option) => option.long).map((option) => option.long);
          candidateFlags = candidateFlags.concat(moreFlags);
          command = command.parent;
        } while (command && !command._enablePositionalOptions);
        suggestion = suggestSimilar(flag, candidateFlags);
      }
      const message = `error: unknown option '${flag}'${suggestion}`;
      this.error(message, { code: "commander.unknownOption" });
    }
    _excessArguments(receivedArgs) {
      if (this._allowExcessArguments)
        return;
      const expected = this.registeredArguments.length;
      const s = expected === 1 ? "" : "s";
      const forSubcommand = this.parent ? ` for '${this.name()}'` : "";
      const message = `error: too many arguments${forSubcommand}. Expected ${expected} argument${s} but got ${receivedArgs.length}.`;
      this.error(message, { code: "commander.excessArguments" });
    }
    unknownCommand() {
      const unknownName = this.args[0];
      let suggestion = "";
      if (this._showSuggestionAfterError) {
        const candidateNames = [];
        this.createHelp().visibleCommands(this).forEach((command) => {
          candidateNames.push(command.name());
          if (command.alias())
            candidateNames.push(command.alias());
        });
        suggestion = suggestSimilar(unknownName, candidateNames);
      }
      const message = `error: unknown command '${unknownName}'${suggestion}`;
      this.error(message, { code: "commander.unknownCommand" });
    }
    version(str, flags, description) {
      if (str === undefined)
        return this._version;
      this._version = str;
      flags = flags || "-V, --version";
      description = description || "output the version number";
      const versionOption = this.createOption(flags, description);
      this._versionOptionName = versionOption.attributeName();
      this._registerOption(versionOption);
      this.on("option:" + versionOption.name(), () => {
        this._outputConfiguration.writeOut(`${str}
`);
        this._exit(0, "commander.version", str);
      });
      return this;
    }
    description(str, argsDescription) {
      if (str === undefined && argsDescription === undefined)
        return this._description;
      this._description = str;
      if (argsDescription) {
        this._argsDescription = argsDescription;
      }
      return this;
    }
    summary(str) {
      if (str === undefined)
        return this._summary;
      this._summary = str;
      return this;
    }
    alias(alias) {
      if (alias === undefined)
        return this._aliases[0];
      let command = this;
      if (this.commands.length !== 0 && this.commands[this.commands.length - 1]._executableHandler) {
        command = this.commands[this.commands.length - 1];
      }
      if (alias === command._name)
        throw new Error("Command alias can't be the same as its name");
      const matchingCommand = this.parent?._findCommand(alias);
      if (matchingCommand) {
        const existingCmd = [matchingCommand.name()].concat(matchingCommand.aliases()).join("|");
        throw new Error(`cannot add alias '${alias}' to command '${this.name()}' as already have command '${existingCmd}'`);
      }
      command._aliases.push(alias);
      return this;
    }
    aliases(aliases) {
      if (aliases === undefined)
        return this._aliases;
      aliases.forEach((alias) => this.alias(alias));
      return this;
    }
    usage(str) {
      if (str === undefined) {
        if (this._usage)
          return this._usage;
        const args = this.registeredArguments.map((arg) => {
          return humanReadableArgName(arg);
        });
        return [].concat(this.options.length || this._helpOption !== null ? "[options]" : [], this.commands.length ? "[command]" : [], this.registeredArguments.length ? args : []).join(" ");
      }
      this._usage = str;
      return this;
    }
    name(str) {
      if (str === undefined)
        return this._name;
      this._name = str;
      return this;
    }
    nameFromFilename(filename) {
      this._name = path.basename(filename, path.extname(filename));
      return this;
    }
    executableDir(path2) {
      if (path2 === undefined)
        return this._executableDir;
      this._executableDir = path2;
      return this;
    }
    helpInformation(contextOptions) {
      const helper = this.createHelp();
      if (helper.helpWidth === undefined) {
        helper.helpWidth = contextOptions && contextOptions.error ? this._outputConfiguration.getErrHelpWidth() : this._outputConfiguration.getOutHelpWidth();
      }
      return helper.formatHelp(this, helper);
    }
    _getHelpContext(contextOptions) {
      contextOptions = contextOptions || {};
      const context = { error: !!contextOptions.error };
      let write;
      if (context.error) {
        write = (arg) => this._outputConfiguration.writeErr(arg);
      } else {
        write = (arg) => this._outputConfiguration.writeOut(arg);
      }
      context.write = contextOptions.write || write;
      context.command = this;
      return context;
    }
    outputHelp(contextOptions) {
      let deprecatedCallback;
      if (typeof contextOptions === "function") {
        deprecatedCallback = contextOptions;
        contextOptions = undefined;
      }
      const context = this._getHelpContext(contextOptions);
      this._getCommandAndAncestors().reverse().forEach((command) => command.emit("beforeAllHelp", context));
      this.emit("beforeHelp", context);
      let helpInformation = this.helpInformation(context);
      if (deprecatedCallback) {
        helpInformation = deprecatedCallback(helpInformation);
        if (typeof helpInformation !== "string" && !Buffer.isBuffer(helpInformation)) {
          throw new Error("outputHelp callback must return a string or a Buffer");
        }
      }
      context.write(helpInformation);
      if (this._getHelpOption()?.long) {
        this.emit(this._getHelpOption().long);
      }
      this.emit("afterHelp", context);
      this._getCommandAndAncestors().forEach((command) => command.emit("afterAllHelp", context));
    }
    helpOption(flags, description) {
      if (typeof flags === "boolean") {
        if (flags) {
          this._helpOption = this._helpOption ?? undefined;
        } else {
          this._helpOption = null;
        }
        return this;
      }
      flags = flags ?? "-h, --help";
      description = description ?? "display help for command";
      this._helpOption = this.createOption(flags, description);
      return this;
    }
    _getHelpOption() {
      if (this._helpOption === undefined) {
        this.helpOption(undefined, undefined);
      }
      return this._helpOption;
    }
    addHelpOption(option) {
      this._helpOption = option;
      return this;
    }
    help(contextOptions) {
      this.outputHelp(contextOptions);
      let exitCode = process2.exitCode || 0;
      if (exitCode === 0 && contextOptions && typeof contextOptions !== "function" && contextOptions.error) {
        exitCode = 1;
      }
      this._exit(exitCode, "commander.help", "(outputHelp)");
    }
    addHelpText(position, text) {
      const allowedValues = ["beforeAll", "before", "after", "afterAll"];
      if (!allowedValues.includes(position)) {
        throw new Error(`Unexpected value for position to addHelpText.
Expecting one of '${allowedValues.join("', '")}'`);
      }
      const helpEvent = `${position}Help`;
      this.on(helpEvent, (context) => {
        let helpStr;
        if (typeof text === "function") {
          helpStr = text({ error: context.error, command: context.command });
        } else {
          helpStr = text;
        }
        if (helpStr) {
          context.write(`${helpStr}
`);
        }
      });
      return this;
    }
    _outputHelpIfRequested(args) {
      const helpOption = this._getHelpOption();
      const helpRequested = helpOption && args.find((arg) => helpOption.is(arg));
      if (helpRequested) {
        this.outputHelp();
        this._exit(0, "commander.helpDisplayed", "(outputHelp)");
      }
    }
  }
  function incrementNodeInspectorPort(args) {
    return args.map((arg) => {
      if (!arg.startsWith("--inspect")) {
        return arg;
      }
      let debugOption;
      let debugHost = "127.0.0.1";
      let debugPort = "9229";
      let match;
      if ((match = arg.match(/^(--inspect(-brk)?)$/)) !== null) {
        debugOption = match[1];
      } else if ((match = arg.match(/^(--inspect(-brk|-port)?)=([^:]+)$/)) !== null) {
        debugOption = match[1];
        if (/^\d+$/.test(match[3])) {
          debugPort = match[3];
        } else {
          debugHost = match[3];
        }
      } else if ((match = arg.match(/^(--inspect(-brk|-port)?)=([^:]+):(\d+)$/)) !== null) {
        debugOption = match[1];
        debugHost = match[3];
        debugPort = match[4];
      }
      if (debugOption && debugPort !== "0") {
        return `${debugOption}=${debugHost}:${parseInt(debugPort) + 1}`;
      }
      return arg;
    });
  }
  exports.Command = Command;
});

// ../../node_modules/.bun/commander@12.1.0/node_modules/commander/index.js
var require_commander = __commonJS((exports) => {
  var { Argument } = require_argument();
  var { Command } = require_command();
  var { CommanderError, InvalidArgumentError } = require_error();
  var { Help } = require_help();
  var { Option } = require_option();
  exports.program = new Command;
  exports.createCommand = (name) => new Command(name);
  exports.createOption = (flags, description) => new Option(flags, description);
  exports.createArgument = (name, description) => new Argument(name, description);
  exports.Command = Command;
  exports.Option = Option;
  exports.Argument = Argument;
  exports.Help = Help;
  exports.CommanderError = CommanderError;
  exports.InvalidArgumentError = InvalidArgumentError;
  exports.InvalidOptionArgumentError = InvalidArgumentError;
});

// src/index.ts
import { createRequire } from "module";

// ../../node_modules/.bun/commander@12.1.0/node_modules/commander/esm.mjs
var import__ = __toESM(require_commander(), 1);
var {
  program,
  createCommand,
  createArgument,
  createOption,
  CommanderError,
  InvalidArgumentError,
  InvalidOptionArgumentError,
  Command,
  Argument,
  Option,
  Help
} = import__.default;

// src/registry.ts
var REGISTRY = [
  {
    name: "assistants",
    npm: "@hasna/assistants",
    description: "Personal AI assistant that runs in your terminal \u2014 powered by Claude",
    bins: { cli: "assistants" },
    hasDb: true,
    hasMcp: false,
    hasHttp: false,
    dataDir: "assistants"
  },
  {
    name: "attachments",
    npm: "@hasna/attachments",
    description: "File transfer for AI agents \u2014 S3-backed upload, shareable links, CLI + MCP + REST API",
    bins: { cli: "attachments", mcp: "attachments-mcp" },
    hasDb: true,
    hasMcp: true,
    hasHttp: false,
    dataDir: "attachments"
  },
  {
    name: "brains",
    npm: "@hasna/brains",
    description: "Fine-tuned model tracker and trainer \u2014 wraps OpenAI + Thinker Labs",
    bins: { cli: "brains", mcp: "brains-mcp", serve: "brains-serve" },
    hasDb: true,
    hasMcp: true,
    hasHttp: true,
    dataDir: "brains"
  },
  {
    name: "browser",
    npm: "@hasna/browser",
    description: "General-purpose browser agent toolkit \u2014 Playwright, CDP, Lightpanda",
    bins: { cli: "browser", mcp: "browser-mcp", serve: "browser-serve" },
    hasDb: true,
    hasMcp: true,
    hasHttp: true,
    dataDir: "browser"
  },
  {
    name: "cloud",
    npm: "@hasna/cloud",
    description: "Shared cloud infrastructure \u2014 database adapter (SQLite + PostgreSQL), sync engine",
    bins: { cli: "cloud", mcp: "cloud-mcp" },
    hasDb: false,
    hasMcp: true,
    hasHttp: false,
    dataDir: "cloud"
  },
  {
    name: "coders",
    npm: "@hasna/coders",
    description: "Open-source coding agent CLI with native @hasna/* ecosystem integration",
    bins: { cli: "coders" },
    hasDb: true,
    hasMcp: false,
    hasHttp: false,
    dataDir: "coders"
  },
  {
    name: "configs",
    npm: "@hasna/configs",
    description: "AI coding agent configuration manager \u2014 store, version, apply, share configs",
    bins: { cli: "configs", mcp: "configs-mcp", serve: "configs-serve" },
    hasDb: true,
    hasMcp: true,
    hasHttp: true,
    dataDir: "configs"
  },
  {
    name: "connectors",
    npm: "@hasna/connectors",
    description: "Open source connector library \u2014 install API connectors with a single command",
    bins: { cli: "connectors", mcp: "connectors-mcp", serve: "connectors-serve" },
    hasDb: true,
    hasMcp: true,
    hasHttp: true,
    dataDir: "connectors"
  },
  {
    name: "contacts",
    npm: "@hasna/contacts",
    description: "Contact management for AI coding agents \u2014 CLI + MCP + Web",
    bins: { cli: "contacts", mcp: "contacts-mcp", serve: "contacts-serve" },
    hasDb: true,
    hasMcp: true,
    hasHttp: true,
    dataDir: "contacts"
  },
  {
    name: "context",
    npm: "@hasna/context",
    description: "Self-hosted documentation context server \u2014 crawl, index, query library docs",
    bins: { cli: "context", mcp: "context-mcp", serve: "context-serve" },
    hasDb: true,
    hasMcp: true,
    hasHttp: true,
    dataDir: "context"
  },
  {
    name: "conversations",
    npm: "@hasna/conversations",
    description: "Real-time CLI messaging for AI agents",
    bins: { cli: "conversations", mcp: "conversations-mcp" },
    hasDb: true,
    hasMcp: true,
    hasHttp: false,
    dataDir: "conversations"
  },
  {
    name: "crawl",
    npm: "@hasna/crawl",
    description: "AI-powered web crawler \u2014 self-hosted Firecrawl alternative",
    bins: { cli: "crawl", mcp: "crawl-mcp", serve: "crawl-serve" },
    hasDb: true,
    hasMcp: true,
    hasHttp: true,
    dataDir: "crawl"
  },
  {
    name: "deployment",
    npm: "@hasna/deployment",
    description: "General-purpose deployment orchestration for AI agents",
    bins: { cli: "deployment", mcp: "deployment-mcp", serve: "deployment-serve" },
    hasDb: true,
    hasMcp: true,
    hasHttp: true,
    dataDir: "deployment"
  },
  {
    name: "economy",
    npm: "@hasna/economy",
    description: "AI coding cost tracker \u2014 CLI + MCP + REST API + web dashboard",
    bins: { cli: "economy", mcp: "economy-mcp", serve: "economy-serve" },
    hasDb: true,
    hasMcp: true,
    hasHttp: true,
    dataDir: "economy"
  },
  {
    name: "emails",
    npm: "@hasna/emails",
    description: "Email management CLI + MCP server + dashboard for Resend and AWS SES",
    bins: { cli: "emails", mcp: "emails-mcp", serve: "emails-serve" },
    hasDb: true,
    hasMcp: true,
    hasHttp: true,
    dataDir: "emails"
  },
  {
    name: "files",
    npm: "@hasna/files",
    description: "Agent-first file management \u2014 index local folders and S3 buckets, tag, search",
    bins: { cli: "files", mcp: "files-mcp", serve: "files-serve" },
    hasDb: true,
    hasMcp: true,
    hasHttp: true,
    dataDir: "files"
  },
  {
    name: "hooks",
    npm: "@hasna/hooks",
    description: "Open source hooks library \u2014 safety, quality, and automation hooks",
    bins: { cli: "hooks" },
    hasDb: true,
    hasMcp: false,
    hasHttp: false,
    dataDir: "hooks"
  },
  {
    name: "implementations",
    npm: "@hasna/implementations",
    description: "Plans, audits, and logs for AI coding agents",
    bins: { cli: "implementations", mcp: "implementations-mcp", serve: "implementations-serve" },
    hasDb: true,
    hasMcp: true,
    hasHttp: true,
    dataDir: "implementations"
  },
  {
    name: "logs",
    npm: "@hasna/logs",
    description: "Log aggregation + browser script + headless page scanner + performance monitoring",
    bins: { cli: "logs", mcp: "logs-mcp", serve: "logs-serve" },
    hasDb: true,
    hasMcp: true,
    hasHttp: true,
    dataDir: "logs"
  },
  {
    name: "markdown",
    npm: "@hasna/markdown",
    description: "Open Markdown Protocol (OMP) \u2014 structured markdown as intermediate representation",
    bins: { cli: "omp", mcp: "omp-mcp", serve: "omp-serve" },
    hasDb: false,
    hasMcp: true,
    hasHttp: true,
    dataDir: "markdown"
  },
  {
    name: "mcps",
    npm: "@hasna/mcps",
    description: "Meta-MCP registry & CLI \u2014 discover, manage, and proxy MCP servers",
    bins: { cli: "mcps", mcp: "mcps-mcp" },
    hasDb: true,
    hasMcp: true,
    hasHttp: false,
    dataDir: "mcps"
  },
  {
    name: "mementos",
    npm: "@hasna/mementos",
    description: "Universal memory system for AI agents \u2014 CLI + MCP server + library API",
    bins: { cli: "mementos", mcp: "mementos-mcp", serve: "mementos-serve" },
    hasDb: true,
    hasMcp: true,
    hasHttp: true,
    dataDir: "mementos"
  },
  {
    name: "microservices",
    npm: "@hasna/microservices",
    description: "Mini business apps for AI agents \u2014 invoices, contacts, bookkeeping and more",
    bins: { cli: "microservices", mcp: "microservices-mcp" },
    hasDb: true,
    hasMcp: true,
    hasHttp: false,
    dataDir: "microservices"
  },
  {
    name: "netwatch",
    npm: "@hasna/netwatch",
    description: "Live network traffic monitor \u2014 track data usage per interface",
    bins: { cli: "netwatch" },
    hasDb: false,
    hasMcp: false,
    hasHttp: false,
    dataDir: "netwatch"
  },
  {
    name: "predictor",
    npm: "@hasna/predictor",
    description: "Swarm intelligence prediction engine \u2014 multi-agent simulation, persona generation",
    bins: { cli: "predictor", mcp: "predictor-mcp" },
    hasDb: true,
    hasMcp: true,
    hasHttp: false,
    dataDir: "predictor"
  },
  {
    name: "prompts",
    npm: "@hasna/prompts",
    description: "Reusable prompt library for AI agents \u2014 CLI + MCP + REST API + web dashboard",
    bins: { cli: "prompts", mcp: "prompts-mcp", serve: "prompts-serve" },
    hasDb: true,
    hasMcp: true,
    hasHttp: true,
    dataDir: "prompts"
  },
  {
    name: "recordings",
    npm: "@hasna/recordings",
    description: "Speech-to-text recording tool \u2014 records, transcribes, and enhances text using AI",
    bins: { cli: "recordings", mcp: "recordings-mcp" },
    hasDb: true,
    hasMcp: true,
    hasHttp: false,
    dataDir: "recordings"
  },
  {
    name: "researcher",
    npm: "@hasna/researcher",
    description: "Universal autonomous experimentation framework \u2014 PFLK/GREE cycles, knowledge graphs",
    bins: { cli: "researcher" },
    hasDb: true,
    hasMcp: false,
    hasHttp: false,
    dataDir: "researcher"
  },
  {
    name: "sandboxes",
    npm: "@hasna/sandboxes",
    description: "Universal cloud sandbox manager \u2014 supports e2b, Daytona, Modal",
    bins: { cli: "sandboxes", mcp: "sandboxes-mcp", serve: "sandboxes-serve" },
    hasDb: true,
    hasMcp: true,
    hasHttp: true,
    dataDir: "sandboxes"
  },
  {
    name: "scaffolds",
    npm: "@hasna/scaffolds",
    description: "App scaffolds for AI agents \u2014 saas, agent, blog, news, social, competition",
    bins: { cli: "scaffolds", mcp: "scaffolds-mcp" },
    hasDb: false,
    hasMcp: true,
    hasHttp: false,
    dataDir: "scaffolds"
  },
  {
    name: "search",
    npm: "@hasna/search",
    description: "Unified search aggregator \u2014 12 providers + YouTube transcription",
    bins: { cli: "search", mcp: "search-mcp", serve: "search-serve" },
    hasDb: true,
    hasMcp: true,
    hasHttp: true,
    dataDir: "search"
  },
  {
    name: "secrets",
    npm: "@hasna/secrets",
    description: "Local secrets vault for AI agents \u2014 store API keys, passwords, tokens",
    bins: { cli: "secrets" },
    hasDb: true,
    hasMcp: false,
    hasHttp: false,
    dataDir: "secrets"
  },
  {
    name: "security",
    npm: "@hasna/security",
    description: "AI-powered security scanner for git repos \u2014 CLI, MCP, API, Web Dashboard",
    bins: { cli: "security", mcp: "security-mcp", serve: "security-serve" },
    hasDb: true,
    hasMcp: true,
    hasHttp: true,
    dataDir: "security"
  },
  {
    name: "sessions",
    npm: "@hasna/sessions",
    description: "Session search and management for AI coding agents",
    bins: { cli: "sessions", mcp: "sessions-mcp", serve: "sessions-serve" },
    hasDb: true,
    hasMcp: true,
    hasHttp: true,
    dataDir: "sessions"
  },
  {
    name: "signatures",
    npm: "@hasna/signatures",
    description: "Open source e-signature platform \u2014 sign PDFs locally, manage documents",
    bins: { cli: "open-signatures", mcp: "signatures-mcp", serve: "signatures-serve" },
    hasDb: true,
    hasMcp: true,
    hasHttp: true,
    dataDir: "signatures"
  },
  {
    name: "skills",
    npm: "@hasna/skills",
    description: "Skills library for AI coding agents",
    bins: { cli: "skills", mcp: "skills-mcp" },
    hasDb: true,
    hasMcp: true,
    hasHttp: false,
    dataDir: "skills"
  },
  {
    name: "styles",
    npm: "@hasna/styles",
    description: "Style management platform \u2014 profiles, preferences, health checks, design system",
    bins: { cli: "styles", mcp: "styles-mcp" },
    hasDb: true,
    hasMcp: true,
    hasHttp: false,
    dataDir: "styles"
  },
  {
    name: "swarm",
    npm: "@hasna/swarm",
    description: "Autonomous swarm orchestrator for headless AI agent CLIs",
    bins: { cli: "swarm", mcp: "swarm-mcp", serve: "swarm-serve" },
    hasDb: true,
    hasMcp: true,
    hasHttp: true,
    dataDir: "swarm"
  },
  {
    name: "telephony",
    npm: "@hasna/telephony",
    description: "Telephony platform for AI agents \u2014 SMS, WhatsApp, voice calls, TTS/STT",
    bins: { cli: "telephony", mcp: "telephony-mcp", serve: "telephony-serve" },
    hasDb: true,
    hasMcp: true,
    hasHttp: true,
    dataDir: "telephony"
  },
  {
    name: "terminal",
    npm: "@hasna/terminal",
    description: "Smart terminal wrapper for AI agents \u2014 structured output, token compression, MCP",
    bins: { cli: "terminal" },
    hasDb: true,
    hasMcp: false,
    hasHttp: false,
    dataDir: "terminal"
  },
  {
    name: "testers",
    npm: "@hasna/testers",
    description: "AI-powered QA testing CLI \u2014 spawns cheap AI agents to test web apps",
    bins: { cli: "testers", mcp: "testers-mcp", serve: "testers-serve" },
    hasDb: true,
    hasMcp: true,
    hasHttp: true,
    dataDir: "testers"
  },
  {
    name: "tickets",
    npm: "@hasna/tickets",
    description: "MCP-native ticketing system \u2014 bugs, features, incidents",
    bins: { cli: "tickets", mcp: "tickets-mcp", serve: "tickets-serve" },
    hasDb: true,
    hasMcp: true,
    hasHttp: true,
    dataDir: "tickets"
  },
  {
    name: "todos",
    npm: "@hasna/todos",
    description: "Universal task management for AI coding agents \u2014 CLI + MCP + TUI",
    bins: { cli: "todos", mcp: "todos-mcp", serve: "todos-serve" },
    hasDb: true,
    hasMcp: true,
    hasHttp: true,
    dataDir: "todos"
  },
  {
    name: "agent-utils",
    npm: "@hasna/agent-utils",
    description: "Shared utilities for token-efficient AI agent MCP servers and CLIs",
    bins: {},
    hasDb: false,
    hasMcp: false,
    hasHttp: false,
    dataDir: "agent-utils"
  },
  {
    name: "wallets",
    npm: "@hasna/wallets",
    description: "Universal wallet management for AI agents \u2014 multi-provider support",
    bins: { cli: "wallets", mcp: "wallets-mcp" },
    hasDb: true,
    hasMcp: true,
    hasHttp: false,
    dataDir: "wallets"
  }
];
function findPackage(name) {
  return REGISTRY.find((p) => p.name === name);
}
function mcpPackages() {
  return REGISTRY.filter((p) => p.hasMcp);
}
function dbPackages() {
  return REGISTRY.filter((p) => p.hasDb);
}
var PACKAGE_COUNT = REGISTRY.length;

// ../../node_modules/.bun/chalk@5.6.2/node_modules/chalk/source/vendor/ansi-styles/index.js
var ANSI_BACKGROUND_OFFSET = 10;
var wrapAnsi16 = (offset = 0) => (code) => `\x1B[${code + offset}m`;
var wrapAnsi256 = (offset = 0) => (code) => `\x1B[${38 + offset};5;${code}m`;
var wrapAnsi16m = (offset = 0) => (red, green, blue) => `\x1B[${38 + offset};2;${red};${green};${blue}m`;
var styles = {
  modifier: {
    reset: [0, 0],
    bold: [1, 22],
    dim: [2, 22],
    italic: [3, 23],
    underline: [4, 24],
    overline: [53, 55],
    inverse: [7, 27],
    hidden: [8, 28],
    strikethrough: [9, 29]
  },
  color: {
    black: [30, 39],
    red: [31, 39],
    green: [32, 39],
    yellow: [33, 39],
    blue: [34, 39],
    magenta: [35, 39],
    cyan: [36, 39],
    white: [37, 39],
    blackBright: [90, 39],
    gray: [90, 39],
    grey: [90, 39],
    redBright: [91, 39],
    greenBright: [92, 39],
    yellowBright: [93, 39],
    blueBright: [94, 39],
    magentaBright: [95, 39],
    cyanBright: [96, 39],
    whiteBright: [97, 39]
  },
  bgColor: {
    bgBlack: [40, 49],
    bgRed: [41, 49],
    bgGreen: [42, 49],
    bgYellow: [43, 49],
    bgBlue: [44, 49],
    bgMagenta: [45, 49],
    bgCyan: [46, 49],
    bgWhite: [47, 49],
    bgBlackBright: [100, 49],
    bgGray: [100, 49],
    bgGrey: [100, 49],
    bgRedBright: [101, 49],
    bgGreenBright: [102, 49],
    bgYellowBright: [103, 49],
    bgBlueBright: [104, 49],
    bgMagentaBright: [105, 49],
    bgCyanBright: [106, 49],
    bgWhiteBright: [107, 49]
  }
};
var modifierNames = Object.keys(styles.modifier);
var foregroundColorNames = Object.keys(styles.color);
var backgroundColorNames = Object.keys(styles.bgColor);
var colorNames = [...foregroundColorNames, ...backgroundColorNames];
function assembleStyles() {
  const codes = new Map;
  for (const [groupName, group] of Object.entries(styles)) {
    for (const [styleName, style] of Object.entries(group)) {
      styles[styleName] = {
        open: `\x1B[${style[0]}m`,
        close: `\x1B[${style[1]}m`
      };
      group[styleName] = styles[styleName];
      codes.set(style[0], style[1]);
    }
    Object.defineProperty(styles, groupName, {
      value: group,
      enumerable: false
    });
  }
  Object.defineProperty(styles, "codes", {
    value: codes,
    enumerable: false
  });
  styles.color.close = "\x1B[39m";
  styles.bgColor.close = "\x1B[49m";
  styles.color.ansi = wrapAnsi16();
  styles.color.ansi256 = wrapAnsi256();
  styles.color.ansi16m = wrapAnsi16m();
  styles.bgColor.ansi = wrapAnsi16(ANSI_BACKGROUND_OFFSET);
  styles.bgColor.ansi256 = wrapAnsi256(ANSI_BACKGROUND_OFFSET);
  styles.bgColor.ansi16m = wrapAnsi16m(ANSI_BACKGROUND_OFFSET);
  Object.defineProperties(styles, {
    rgbToAnsi256: {
      value(red, green, blue) {
        if (red === green && green === blue) {
          if (red < 8) {
            return 16;
          }
          if (red > 248) {
            return 231;
          }
          return Math.round((red - 8) / 247 * 24) + 232;
        }
        return 16 + 36 * Math.round(red / 255 * 5) + 6 * Math.round(green / 255 * 5) + Math.round(blue / 255 * 5);
      },
      enumerable: false
    },
    hexToRgb: {
      value(hex) {
        const matches = /[a-f\d]{6}|[a-f\d]{3}/i.exec(hex.toString(16));
        if (!matches) {
          return [0, 0, 0];
        }
        let [colorString] = matches;
        if (colorString.length === 3) {
          colorString = [...colorString].map((character) => character + character).join("");
        }
        const integer = Number.parseInt(colorString, 16);
        return [
          integer >> 16 & 255,
          integer >> 8 & 255,
          integer & 255
        ];
      },
      enumerable: false
    },
    hexToAnsi256: {
      value: (hex) => styles.rgbToAnsi256(...styles.hexToRgb(hex)),
      enumerable: false
    },
    ansi256ToAnsi: {
      value(code) {
        if (code < 8) {
          return 30 + code;
        }
        if (code < 16) {
          return 90 + (code - 8);
        }
        let red;
        let green;
        let blue;
        if (code >= 232) {
          red = ((code - 232) * 10 + 8) / 255;
          green = red;
          blue = red;
        } else {
          code -= 16;
          const remainder = code % 36;
          red = Math.floor(code / 36) / 5;
          green = Math.floor(remainder / 6) / 5;
          blue = remainder % 6 / 5;
        }
        const value = Math.max(red, green, blue) * 2;
        if (value === 0) {
          return 30;
        }
        let result = 30 + (Math.round(blue) << 2 | Math.round(green) << 1 | Math.round(red));
        if (value === 2) {
          result += 60;
        }
        return result;
      },
      enumerable: false
    },
    rgbToAnsi: {
      value: (red, green, blue) => styles.ansi256ToAnsi(styles.rgbToAnsi256(red, green, blue)),
      enumerable: false
    },
    hexToAnsi: {
      value: (hex) => styles.ansi256ToAnsi(styles.hexToAnsi256(hex)),
      enumerable: false
    }
  });
  return styles;
}
var ansiStyles = assembleStyles();
var ansi_styles_default = ansiStyles;

// ../../node_modules/.bun/chalk@5.6.2/node_modules/chalk/source/vendor/supports-color/index.js
import process2 from "process";
import os from "os";
import tty from "tty";
function hasFlag(flag, argv = globalThis.Deno ? globalThis.Deno.args : process2.argv) {
  const prefix = flag.startsWith("-") ? "" : flag.length === 1 ? "-" : "--";
  const position = argv.indexOf(prefix + flag);
  const terminatorPosition = argv.indexOf("--");
  return position !== -1 && (terminatorPosition === -1 || position < terminatorPosition);
}
var { env } = process2;
var flagForceColor;
if (hasFlag("no-color") || hasFlag("no-colors") || hasFlag("color=false") || hasFlag("color=never")) {
  flagForceColor = 0;
} else if (hasFlag("color") || hasFlag("colors") || hasFlag("color=true") || hasFlag("color=always")) {
  flagForceColor = 1;
}
function envForceColor() {
  if ("FORCE_COLOR" in env) {
    if (env.FORCE_COLOR === "true") {
      return 1;
    }
    if (env.FORCE_COLOR === "false") {
      return 0;
    }
    return env.FORCE_COLOR.length === 0 ? 1 : Math.min(Number.parseInt(env.FORCE_COLOR, 10), 3);
  }
}
function translateLevel(level) {
  if (level === 0) {
    return false;
  }
  return {
    level,
    hasBasic: true,
    has256: level >= 2,
    has16m: level >= 3
  };
}
function _supportsColor(haveStream, { streamIsTTY, sniffFlags = true } = {}) {
  const noFlagForceColor = envForceColor();
  if (noFlagForceColor !== undefined) {
    flagForceColor = noFlagForceColor;
  }
  const forceColor = sniffFlags ? flagForceColor : noFlagForceColor;
  if (forceColor === 0) {
    return 0;
  }
  if (sniffFlags) {
    if (hasFlag("color=16m") || hasFlag("color=full") || hasFlag("color=truecolor")) {
      return 3;
    }
    if (hasFlag("color=256")) {
      return 2;
    }
  }
  if ("TF_BUILD" in env && "AGENT_NAME" in env) {
    return 1;
  }
  if (haveStream && !streamIsTTY && forceColor === undefined) {
    return 0;
  }
  const min = forceColor || 0;
  if (env.TERM === "dumb") {
    return min;
  }
  if (process2.platform === "win32") {
    const osRelease = os.release().split(".");
    if (Number(osRelease[0]) >= 10 && Number(osRelease[2]) >= 10586) {
      return Number(osRelease[2]) >= 14931 ? 3 : 2;
    }
    return 1;
  }
  if ("CI" in env) {
    if (["GITHUB_ACTIONS", "GITEA_ACTIONS", "CIRCLECI"].some((key) => (key in env))) {
      return 3;
    }
    if (["TRAVIS", "APPVEYOR", "GITLAB_CI", "BUILDKITE", "DRONE"].some((sign) => (sign in env)) || env.CI_NAME === "codeship") {
      return 1;
    }
    return min;
  }
  if ("TEAMCITY_VERSION" in env) {
    return /^(9\.(0*[1-9]\d*)\.|\d{2,}\.)/.test(env.TEAMCITY_VERSION) ? 1 : 0;
  }
  if (env.COLORTERM === "truecolor") {
    return 3;
  }
  if (env.TERM === "xterm-kitty") {
    return 3;
  }
  if (env.TERM === "xterm-ghostty") {
    return 3;
  }
  if (env.TERM === "wezterm") {
    return 3;
  }
  if ("TERM_PROGRAM" in env) {
    const version = Number.parseInt((env.TERM_PROGRAM_VERSION || "").split(".")[0], 10);
    switch (env.TERM_PROGRAM) {
      case "iTerm.app": {
        return version >= 3 ? 3 : 2;
      }
      case "Apple_Terminal": {
        return 2;
      }
    }
  }
  if (/-256(color)?$/i.test(env.TERM)) {
    return 2;
  }
  if (/^screen|^xterm|^vt100|^vt220|^rxvt|color|ansi|cygwin|linux/i.test(env.TERM)) {
    return 1;
  }
  if ("COLORTERM" in env) {
    return 1;
  }
  return min;
}
function createSupportsColor(stream, options = {}) {
  const level = _supportsColor(stream, {
    streamIsTTY: stream && stream.isTTY,
    ...options
  });
  return translateLevel(level);
}
var supportsColor = {
  stdout: createSupportsColor({ isTTY: tty.isatty(1) }),
  stderr: createSupportsColor({ isTTY: tty.isatty(2) })
};
var supports_color_default = supportsColor;

// ../../node_modules/.bun/chalk@5.6.2/node_modules/chalk/source/utilities.js
function stringReplaceAll(string, substring, replacer) {
  let index = string.indexOf(substring);
  if (index === -1) {
    return string;
  }
  const substringLength = substring.length;
  let endIndex = 0;
  let returnValue = "";
  do {
    returnValue += string.slice(endIndex, index) + substring + replacer;
    endIndex = index + substringLength;
    index = string.indexOf(substring, endIndex);
  } while (index !== -1);
  returnValue += string.slice(endIndex);
  return returnValue;
}
function stringEncaseCRLFWithFirstIndex(string, prefix, postfix, index) {
  let endIndex = 0;
  let returnValue = "";
  do {
    const gotCR = string[index - 1] === "\r";
    returnValue += string.slice(endIndex, gotCR ? index - 1 : index) + prefix + (gotCR ? `\r
` : `
`) + postfix;
    endIndex = index + 1;
    index = string.indexOf(`
`, endIndex);
  } while (index !== -1);
  returnValue += string.slice(endIndex);
  return returnValue;
}

// ../../node_modules/.bun/chalk@5.6.2/node_modules/chalk/source/index.js
var { stdout: stdoutColor, stderr: stderrColor } = supports_color_default;
var GENERATOR = Symbol("GENERATOR");
var STYLER = Symbol("STYLER");
var IS_EMPTY = Symbol("IS_EMPTY");
var levelMapping = [
  "ansi",
  "ansi",
  "ansi256",
  "ansi16m"
];
var styles2 = Object.create(null);
var applyOptions = (object, options = {}) => {
  if (options.level && !(Number.isInteger(options.level) && options.level >= 0 && options.level <= 3)) {
    throw new Error("The `level` option should be an integer from 0 to 3");
  }
  const colorLevel = stdoutColor ? stdoutColor.level : 0;
  object.level = options.level === undefined ? colorLevel : options.level;
};
var chalkFactory = (options) => {
  const chalk = (...strings) => strings.join(" ");
  applyOptions(chalk, options);
  Object.setPrototypeOf(chalk, createChalk.prototype);
  return chalk;
};
function createChalk(options) {
  return chalkFactory(options);
}
Object.setPrototypeOf(createChalk.prototype, Function.prototype);
for (const [styleName, style] of Object.entries(ansi_styles_default)) {
  styles2[styleName] = {
    get() {
      const builder = createBuilder(this, createStyler(style.open, style.close, this[STYLER]), this[IS_EMPTY]);
      Object.defineProperty(this, styleName, { value: builder });
      return builder;
    }
  };
}
styles2.visible = {
  get() {
    const builder = createBuilder(this, this[STYLER], true);
    Object.defineProperty(this, "visible", { value: builder });
    return builder;
  }
};
var getModelAnsi = (model, level, type, ...arguments_) => {
  if (model === "rgb") {
    if (level === "ansi16m") {
      return ansi_styles_default[type].ansi16m(...arguments_);
    }
    if (level === "ansi256") {
      return ansi_styles_default[type].ansi256(ansi_styles_default.rgbToAnsi256(...arguments_));
    }
    return ansi_styles_default[type].ansi(ansi_styles_default.rgbToAnsi(...arguments_));
  }
  if (model === "hex") {
    return getModelAnsi("rgb", level, type, ...ansi_styles_default.hexToRgb(...arguments_));
  }
  return ansi_styles_default[type][model](...arguments_);
};
var usedModels = ["rgb", "hex", "ansi256"];
for (const model of usedModels) {
  styles2[model] = {
    get() {
      const { level } = this;
      return function(...arguments_) {
        const styler = createStyler(getModelAnsi(model, levelMapping[level], "color", ...arguments_), ansi_styles_default.color.close, this[STYLER]);
        return createBuilder(this, styler, this[IS_EMPTY]);
      };
    }
  };
  const bgModel = "bg" + model[0].toUpperCase() + model.slice(1);
  styles2[bgModel] = {
    get() {
      const { level } = this;
      return function(...arguments_) {
        const styler = createStyler(getModelAnsi(model, levelMapping[level], "bgColor", ...arguments_), ansi_styles_default.bgColor.close, this[STYLER]);
        return createBuilder(this, styler, this[IS_EMPTY]);
      };
    }
  };
}
var proto = Object.defineProperties(() => {}, {
  ...styles2,
  level: {
    enumerable: true,
    get() {
      return this[GENERATOR].level;
    },
    set(level) {
      this[GENERATOR].level = level;
    }
  }
});
var createStyler = (open, close, parent) => {
  let openAll;
  let closeAll;
  if (parent === undefined) {
    openAll = open;
    closeAll = close;
  } else {
    openAll = parent.openAll + open;
    closeAll = close + parent.closeAll;
  }
  return {
    open,
    close,
    openAll,
    closeAll,
    parent
  };
};
var createBuilder = (self, _styler, _isEmpty) => {
  const builder = (...arguments_) => applyStyle(builder, arguments_.length === 1 ? "" + arguments_[0] : arguments_.join(" "));
  Object.setPrototypeOf(builder, proto);
  builder[GENERATOR] = self;
  builder[STYLER] = _styler;
  builder[IS_EMPTY] = _isEmpty;
  return builder;
};
var applyStyle = (self, string) => {
  if (self.level <= 0 || !string) {
    return self[IS_EMPTY] ? "" : string;
  }
  let styler = self[STYLER];
  if (styler === undefined) {
    return string;
  }
  const { openAll, closeAll } = styler;
  if (string.includes("\x1B")) {
    while (styler !== undefined) {
      string = stringReplaceAll(string, styler.close, styler.open);
      styler = styler.parent;
    }
  }
  const lfIndex = string.indexOf(`
`);
  if (lfIndex !== -1) {
    string = stringEncaseCRLFWithFirstIndex(string, closeAll, openAll, lfIndex);
  }
  return openAll + string + closeAll;
};
Object.defineProperties(createChalk.prototype, styles2);
var chalk = createChalk();
var chalkStderr = createChalk({ level: stderrColor ? stderrColor.level : 0 });
var source_default = chalk;

// src/utils.ts
import { execSync, spawn, execFileSync } from "child_process";
import { existsSync, statSync, readdirSync, mkdirSync, chmodSync, renameSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join, resolve, dirname } from "path";
import { homedir } from "os";
var HASNA_HOME = resolve(join(homedir(), ".hasna"));
var CHILD_MAX_BUFFER = 256 * 1024 * 1024;
function dataPath(name) {
  return join(HASNA_HOME, name);
}
function dirExists(p) {
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}
function fileExists(p) {
  try {
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
}
function dbSize(dir) {
  if (!dirExists(dir))
    return 0;
  try {
    let total = 0;
    const entries = readdirSync(dir, { recursive: true });
    for (const entry of entries) {
      const full = join(dir, String(entry));
      if (full.endsWith(".db") || full.endsWith(".sqlite") || full.endsWith(".sqlite3")) {
        try {
          total += statSync(full).size;
        } catch {}
      }
    }
    return total;
  } catch {
    return 0;
  }
}
function formatBytes(bytes) {
  if (bytes === 0)
    return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}
function execSafe(cmd, timeoutMs = 1e4) {
  try {
    return execSync(cmd, {
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: CHILD_MAX_BUFFER
    }).trim();
  } catch {
    return null;
  }
}
function spawnSafe(cmd, args, timeoutMs = 1e4, env2 = {}, cwd) {
  try {
    const childEnv = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined)
        childEnv[k] = v;
    }
    for (const [k, v] of Object.entries(env2)) {
      if (v === undefined)
        delete childEnv[k];
      else
        childEnv[k] = v;
    }
    return execFileSync(cmd, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["pipe", "pipe", "pipe"],
      env: childEnv,
      cwd,
      maxBuffer: CHILD_MAX_BUFFER
    }).trim();
  } catch {
    return null;
  }
}
var SWAP_JOURNAL_SUFFIX = ".swap-journal";
function recoverInterruptedSwap(targetDir) {
  const journalPath = `${targetDir}${SWAP_JOURNAL_SUFFIX}`;
  if (!fileExists(journalPath))
    return { ok: true, message: null };
  let backupName = "";
  try {
    backupName = readFileSync(journalPath, "utf8").trim();
  } catch {
    return { ok: false, message: `swap journal ${journalPath} exists but could not be read \u2014 manual recovery required` };
  }
  if (backupName && dirExists(backupName) && !dirExists(targetDir)) {
    try {
      renameSync(backupName, targetDir);
      try {
        unlinkSync(journalPath);
      } catch {}
      return { ok: true, message: `recovered interrupted swap: live tree restored at ${targetDir}` };
    } catch {
      return { ok: false, message: `interrupted swap: could not restore ${targetDir} from ${backupName}` };
    }
  }
  if (backupName && dirExists(backupName) && dirExists(targetDir)) {
    const rm = spawnSafe("rm", ["-rf", backupName], 60000);
    if (rm === null) {
      return { ok: false, message: `retained displaced live tree at ${backupName} (removal failed); journal kept` };
    }
    try {
      unlinkSync(journalPath);
    } catch {}
    return { ok: true, message: null };
  }
  try {
    unlinkSync(journalPath);
  } catch {}
  return dirExists(targetDir) ? { ok: true, message: null } : { ok: false, message: `interrupted swap: neither ${targetDir} nor its journaled backup exists` };
}
function createPreCopySnapshot(snapDirBase, targetDir, timeoutMs) {
  const snapDir = `${snapDirBase}.precopy`;
  try {
    mkdirSync(snapDir, { recursive: true, mode: 448 });
    chmodSync(snapDir, 448);
  } catch {
    return null;
  }
  const snapshot = join(snapDir, "precopy-snapshot.tar.gz");
  const snapResult = spawnSafe("tar", ["-czf", snapshot, "-C", targetDir, "."], timeoutMs);
  if (snapResult === null || !fileExists(snapshot)) {
    return null;
  }
  try {
    chmodSync(snapshot, 384);
  } catch {}
  return snapshot;
}
function atomicSwapRestore(restoreDir, targetDir) {
  const backupDir = `${targetDir}.swap-backup-${Date.now()}`;
  const journalPath = `${targetDir}${SWAP_JOURNAL_SUFFIX}`;
  try {
    writeFileSync(journalPath, `${backupDir}
`, { mode: 384 });
  } catch {
    return { ok: false, targetRestored: true, retained: journalPath };
  }
  try {
    renameSync(targetDir, backupDir);
  } catch {
    try {
      unlinkSync(journalPath);
    } catch {}
    return { ok: false, targetRestored: true, retained: null };
  }
  try {
    renameSync(restoreDir, targetDir);
  } catch {
    try {
      renameSync(backupDir, targetDir);
      try {
        unlinkSync(journalPath);
      } catch {}
      return { ok: false, targetRestored: true, retained: null };
    } catch {
      return { ok: false, targetRestored: false, retained: journalPath };
    }
  }
  const rm = spawnSafe("rm", ["-rf", backupDir], 60000);
  if (rm === null) {
    return { ok: false, targetRestored: true, retained: backupDir };
  }
  try {
    unlinkSync(journalPath);
  } catch {}
  return { ok: true, targetRestored: true, retained: null };
}
function copyStagedWithRollback(stagedDir, targetDir, timeoutMs = 120000) {
  const recovery = recoverInterruptedSwap(targetDir);
  if (!recovery.ok) {
    return { ok: false, copyApplied: false, rolledBack: false, snapshot: null, retainedSwap: recovery.message, warning: null };
  }
  const warning = recovery.message;
  if (!dirExists(targetDir)) {
    try {
      mkdirSync(targetDir, { recursive: true });
    } catch {
      return { ok: false, copyApplied: false, rolledBack: false, snapshot: null, retainedSwap: null, warning };
    }
  }
  let snapshot = null;
  if (dirExists(targetDir)) {
    snapshot = createPreCopySnapshot(stagedDir, targetDir, timeoutMs);
    if (snapshot === null) {
      return { ok: false, copyApplied: false, rolledBack: false, snapshot: null, retainedSwap: null, warning };
    }
  }
  const copyResult = spawnSafe("cp", ["-a", `${stagedDir}/.`, `${targetDir}/`], timeoutMs);
  if (copyResult !== null) {
    if (snapshot) {
      const removed = removeSnapshotTree(snapshot);
      if (!removed) {
        return { ok: false, copyApplied: true, rolledBack: false, snapshot, retainedSwap: null, warning };
      }
    }
    return { ok: true, copyApplied: true, rolledBack: false, snapshot: null, retainedSwap: null, warning };
  }
  if (snapshot) {
    const restoreDir = `${targetDir}.restore-${Date.now()}`;
    try {
      mkdirSync(restoreDir, { mode: 448 });
    } catch {
      return { ok: false, copyApplied: false, rolledBack: false, snapshot, retainedSwap: null, warning };
    }
    const extractResult = spawnSafe("tar", ["-xzf", snapshot, "-C", restoreDir], timeoutMs);
    if (extractResult === null || !dirExists(restoreDir)) {
      spawnSafe("rm", ["-rf", restoreDir], 1e4);
      return { ok: false, copyApplied: false, rolledBack: false, snapshot, retainedSwap: null, warning };
    }
    const swap = atomicSwapRestore(restoreDir, targetDir);
    if (!swap.ok) {
      return { ok: false, copyApplied: false, rolledBack: false, snapshot, retainedSwap: swap.retained, warning };
    }
    const removed = removeSnapshotTree(snapshot);
    if (!removed) {
      return { ok: false, copyApplied: false, rolledBack: true, snapshot, retainedSwap: null, warning };
    }
    return { ok: false, copyApplied: false, rolledBack: true, snapshot: null, retainedSwap: null, warning };
  }
  return { ok: false, copyApplied: false, rolledBack: false, snapshot: null, retainedSwap: null, warning };
}
function removeSnapshotTree(snapshotPath) {
  const snapDir = dirname(snapshotPath);
  const rm = spawnSafe("rm", ["-rf", snapDir], 5000);
  return rm !== null;
}
function verifyTarball(filePath, timeoutMs = 60000) {
  return spawnSafe("tar", ["-tzf", filePath], timeoutMs);
}
function listTarball(filePath, limit, timeoutMs = 60000) {
  const listing = verifyTarball(filePath, timeoutMs);
  if (listing === null)
    return null;
  return listing.split(`
`).slice(0, limit).join(`
`);
}
function getInstalledVersion(npmName) {
  const result = execSafe(`npm ls -g ${npmName} --depth=0 --json 2>/dev/null`);
  if (!result)
    return null;
  try {
    const parsed = JSON.parse(result);
    const deps = parsed.dependencies || {};
    const key = Object.keys(deps).find((k) => k === npmName);
    return key ? deps[key].version || null : null;
  } catch {
    return null;
  }
}
function getLatestVersion(npmName) {
  return execSafe(`npm view ${npmName} version 2>/dev/null`);
}
function spawnWithTimeout(cmd, args, timeoutMs, env2 = {}) {
  return new Promise((resolve2) => {
    let stdout = "";
    let stderr = "";
    let killed = false;
    let settled = false;
    let killTimer = null;
    const finish = (result) => {
      if (settled)
        return;
      settled = true;
      clearTimeout(termTimer);
      if (killTimer)
        clearTimeout(killTimer);
      resolve2(result);
    };
    const opts = {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env2 }
    };
    const child = spawn(cmd, args, opts);
    const termTimer = setTimeout(() => {
      killed = true;
      try {
        child.kill("SIGTERM");
      } catch {}
      killTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
        finish({ code: null, stdout, stderr: stderr + `
[timeout]`, timedOut: true });
      }, 1000);
    }, timeoutMs);
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      if (killed) {
        finish({ code: null, stdout, stderr: stderr + `
[timeout]`, timedOut: true });
      } else {
        finish({ code, stdout, stderr, timedOut: false });
      }
    });
    child.on("error", (err) => {
      finish({ code: null, stdout, stderr: err.message, timedOut: false });
    });
  });
}
function binaryExists(name) {
  return execSafe(`which ${name}`) !== null;
}
function pad(str, width) {
  return str.length >= width ? str.slice(0, width) : str + " ".repeat(width - str.length);
}
function truncate(str, max) {
  return str.length <= max ? str : str.slice(0, max - 1) + "\u2026";
}

// src/commands/status.ts
function getStatusRow(pkg) {
  const installed = getInstalledVersion(pkg.npm);
  const dp = dataPath(pkg.dataDir);
  const hasDir = dirExists(dp);
  const size = pkg.hasDb ? dbSize(dp) : 0;
  return {
    name: pkg.name,
    installed: installed || source_default.dim("--"),
    db: pkg.hasDb ? size > 0 ? formatBytes(size) : source_default.yellow("empty") : source_default.dim("--"),
    mcp: pkg.hasMcp ? pkg.bins.mcp && binaryExists(pkg.bins.mcp) ? source_default.green("ok") : source_default.red("missing") : source_default.dim("--"),
    http: pkg.hasHttp ? pkg.bins.serve && binaryExists(pkg.bins.serve) ? source_default.green("ok") : source_default.red("missing") : source_default.dim("--"),
    dir: hasDir ? source_default.green("ok") : source_default.red("missing")
  };
}
function registerStatusCommand(program2) {
  program2.command("status").description("Show table of all @hasna/* packages: installed version, DB size, MCP/HTTP status").option("-f, --filter <name>", "Filter by package name (substring match)").option("--installed", "Only show installed packages").option("--json", "Output as JSON").action((opts) => {
    let packages = REGISTRY;
    if (opts.filter) {
      const f = opts.filter.toLowerCase();
      packages = packages.filter((p) => p.name.toLowerCase().includes(f));
    }
    const rows = packages.map(getStatusRow);
    if (opts.installed) {
      const filtered = rows.filter((r) => !r.installed.includes("--"));
      if (filtered.length === 0) {
        console.log(source_default.yellow("No @hasna/* packages installed globally."));
        return;
      }
      printTable(filtered, opts.json);
    } else {
      printTable(rows, opts.json);
    }
  });
}
function printTable(rows, json) {
  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  const cols = { name: 18, installed: 12, db: 12, mcp: 9, http: 9, dir: 9 };
  console.log(source_default.bold(pad("Package", cols.name) + pad("Version", cols.installed) + pad("DB Size", cols.db) + pad("MCP", cols.mcp) + pad("HTTP", cols.http) + pad("DataDir", cols.dir)));
  console.log(source_default.dim("\u2500".repeat(cols.name + cols.installed + cols.db + cols.mcp + cols.http + cols.dir)));
  for (const row of rows) {
    console.log(pad(truncate(row.name, cols.name - 1), cols.name) + pad(row.installed, cols.installed) + pad(row.db, cols.db) + pad(row.mcp, cols.mcp) + pad(row.http, cols.http) + pad(row.dir, cols.dir));
  }
  console.log();
  console.log(source_default.dim(`${rows.length} packages total`));
}

// src/commands/doctor.ts
function icon(status) {
  switch (status) {
    case "pass":
      return source_default.green("[PASS]");
    case "warn":
      return source_default.yellow("[WARN]");
    case "fail":
      return source_default.red("[FAIL]");
  }
}
async function runChecks(verbose) {
  const checks = [];
  checks.push({
    label: "Base data directory",
    status: dirExists(HASNA_HOME) ? "pass" : "fail",
    detail: dirExists(HASNA_HOME) ? HASNA_HOME : `${HASNA_HOME} does not exist \u2014 run "hasna init"`
  });
  let missingDirs = 0;
  for (const pkg of REGISTRY) {
    if (!pkg.hasDb)
      continue;
    const dp = dataPath(pkg.dataDir);
    if (!dirExists(dp)) {
      missingDirs++;
      if (verbose) {
        checks.push({ label: `Data dir: ${pkg.name}`, status: "warn", detail: `${dp} missing` });
      }
    }
  }
  if (!verbose && missingDirs > 0) {
    checks.push({
      label: "Missing data directories",
      status: "warn",
      detail: `${missingDirs} package data dirs missing \u2014 run "hasna init" to create them`
    });
  }
  const bunVersion = execSafe("bun --version");
  checks.push({
    label: "Bun runtime",
    status: bunVersion ? "pass" : "fail",
    detail: bunVersion ? `v${bunVersion}` : "bun not found on PATH"
  });
  const nodeVersion = execSafe("node --version");
  checks.push({
    label: "Node.js runtime",
    status: nodeVersion ? "pass" : "warn",
    detail: nodeVersion || "node not found on PATH"
  });
  const npmVersion = execSafe("npm --version");
  checks.push({
    label: "npm",
    status: npmVersion ? "pass" : "fail",
    detail: npmVersion ? `v${npmVersion}` : "npm not found"
  });
  const cloudVersion = getInstalledVersion("@hasna/cloud");
  checks.push({
    label: "@hasna/cloud installed",
    status: cloudVersion ? "pass" : "warn",
    detail: cloudVersion ? `v${cloudVersion}` : "not installed globally"
  });
  const rdsHost = process.env.HASNA_RDS_HOST || process.env.CLOUD_PG_HOST;
  if (rdsHost) {
    const rdsUser = process.env.HASNA_RDS_USER || process.env.CLOUD_PG_USER || "hasna_admin";
    const rdsPassword = process.env.HASNA_RDS_PASSWORD || process.env.CLOUD_PG_PASSWORD || "";
    const pgResult = await spawnWithTimeout("psql", ["-h", rdsHost, "-U", rdsUser, "-d", "postgres", "-c", "SELECT 1;"], 5000, { PGPASSWORD: rdsPassword });
    const connected = pgResult.code === 0 && pgResult.stdout.includes("1");
    checks.push({
      label: "RDS connection",
      status: connected ? "pass" : "fail",
      detail: connected ? `Connected to ${rdsHost}` : `Failed to connect to ${rdsHost}`
    });
  } else {
    checks.push({
      label: "RDS connection",
      status: "warn",
      detail: "No RDS configured (set HASNA_RDS_HOST or CLOUD_PG_HOST)"
    });
  }
  const keyPackages = ["@hasna/cloud", "@hasna/todos", "@hasna/mementos", "@hasna/conversations"];
  for (const npm of keyPackages) {
    const installed = getInstalledVersion(npm);
    if (!installed)
      continue;
    const latest = getLatestVersion(npm);
    if (!latest)
      continue;
    const upToDate = installed === latest;
    checks.push({
      label: `${npm} version`,
      status: upToDate ? "pass" : "warn",
      detail: upToDate ? `v${installed} (latest)` : `v${installed} -> v${latest} available`
    });
  }
  let missingMcp = 0;
  let totalMcp = 0;
  for (const pkg of REGISTRY) {
    if (!pkg.bins.mcp)
      continue;
    totalMcp++;
    if (!binaryExists(pkg.bins.mcp)) {
      missingMcp++;
      if (verbose) {
        checks.push({ label: `MCP binary: ${pkg.bins.mcp}`, status: "warn", detail: "not found on PATH" });
      }
    }
  }
  if (!verbose) {
    checks.push({
      label: "MCP binaries",
      status: missingMcp === 0 ? "pass" : missingMcp === totalMcp ? "fail" : "warn",
      detail: `${totalMcp - missingMcp}/${totalMcp} found on PATH`
    });
  }
  return checks;
}
function registerDoctorCommand(program2) {
  program2.command("doctor").description("Run health checks: dirs, configs, RDS, versions, MCP binaries").option("-v, --verbose", "Show individual check details for every package").action(async (opts) => {
    console.log(source_default.bold("hasna doctor") + source_default.dim(` \u2014 running health checks...
`));
    const checks = await runChecks(!!opts.verbose);
    const passed = checks.filter((c) => c.status === "pass").length;
    const warned = checks.filter((c) => c.status === "warn").length;
    const failed = checks.filter((c) => c.status === "fail").length;
    for (const check of checks) {
      console.log(`  ${icon(check.status)} ${check.label}: ${source_default.dim(check.detail)}`);
    }
    console.log();
    console.log(`  ${source_default.green(`${passed} passed`)}, ${source_default.yellow(`${warned} warnings`)}, ${source_default.red(`${failed} failed`)}`);
    if (failed > 0) {
      console.log(source_default.red(`
Some checks failed. Run 'hasna init' to fix common issues.`));
      process.exit(1);
    }
  });
}

// src/commands/init.ts
import { mkdirSync as mkdirSync2, writeFileSync as writeFileSync2, existsSync as existsSync2, readFileSync as readFileSync2 } from "fs";
import { join as join2 } from "path";
import { createInterface } from "readline";
function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve2) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve2(answer.trim());
    });
  });
}
function ensureDir(dir) {
  if (dirExists(dir))
    return false;
  try {
    mkdirSync2(dir, { recursive: true });
    return true;
  } catch (err) {
    console.error(source_default.red(`  Failed to create ${dir}: ${err}`));
    return false;
  }
}
function registerInitCommand(program2) {
  program2.command("init").description("Set up the hasna ecosystem: create data dirs, optionally configure RDS, install packages").option("--skip-install", "Skip npm install of all packages").option("--skip-rds", "Skip RDS configuration prompt").option("-y, --yes", "Non-interactive mode, accept all defaults").action(async (opts) => {
    console.log(source_default.bold("hasna init") + source_default.dim(` \u2014 setting up your environment
`));
    let created = 0;
    if (ensureDir(HASNA_HOME)) {
      console.log(source_default.green(`  Created ${HASNA_HOME}`));
      created++;
    } else {
      console.log(source_default.dim(`  ${HASNA_HOME} already exists`));
    }
    console.log(source_default.dim(`
  Creating data directories...`));
    for (const pkg of REGISTRY) {
      const dp = dataPath(pkg.dataDir);
      if (ensureDir(dp)) {
        created++;
      }
    }
    console.log(source_default.green(`  ${created} directories created
`));
    const configPath = join2(HASNA_HOME, "cli", "config.json");
    ensureDir(join2(HASNA_HOME, "cli"));
    if (!existsSync2(configPath)) {
      const defaultConfig = {
        version: 1,
        rds: {
          host: "",
          port: 5432,
          user: "",
          database: "cli",
          configured: false
        },
        lastInit: new Date().toISOString(),
        autoUpdate: false
      };
      writeFileSync2(configPath, JSON.stringify(defaultConfig, null, 2));
      console.log(source_default.green(`  Created config: ${configPath}`));
    } else {
      console.log(source_default.dim(`  Config exists: ${configPath}`));
    }
    if (!opts.skipRds) {
      console.log();
      let configureRds = false;
      if (opts.yes) {
        configureRds = !!(process.env.HASNA_RDS_HOST || process.env.CLOUD_PG_HOST);
      } else {
        const answer = await ask("  Configure RDS connection? [y/N] ");
        configureRds = answer.toLowerCase() === "y";
      }
      if (configureRds) {
        const host = process.env.HASNA_RDS_HOST || process.env.CLOUD_PG_HOST || (opts.yes ? "" : await ask(`  RDS host []: `));
        const user = process.env.HASNA_RDS_USER || process.env.CLOUD_PG_USER || (opts.yes ? "hasna_admin" : await ask("  RDS user [hasna_admin]: ") || "hasna_admin");
        const db = opts.yes ? "cli" : await ask("  RDS database [cli]: ") || "cli";
        if (host) {
          const pw = process.env.HASNA_RDS_PASSWORD || process.env.CLOUD_PG_PASSWORD || "";
          const result = await spawnWithTimeout("psql", ["-h", host, "-U", user, "-d", db, "-c", "SELECT 1;"], 5000, { PGPASSWORD: pw });
          if (result.code === 0 && result.stdout.includes("1")) {
            console.log(source_default.green(`  RDS connection successful: ${host}/${db}`));
            try {
              const cfg = JSON.parse(readFileSync2(configPath, "utf8"));
              cfg.rds = { host, port: 5432, user, database: db, configured: true };
              writeFileSync2(configPath, JSON.stringify(cfg, null, 2));
            } catch {}
          } else {
            console.log(source_default.yellow(`  RDS connection failed \u2014 skipping. You can reconfigure later with "hasna init".`));
          }
        }
      }
    }
    if (!opts.skipInstall) {
      console.log();
      let doInstall = false;
      if (opts.yes) {
        doInstall = true;
      } else {
        const answer = await ask("  Install all @hasna/* packages globally? [y/N] ");
        doInstall = answer.toLowerCase() === "y";
      }
      if (doInstall) {
        console.log(source_default.dim(`
  Installing packages (this may take a while)...
`));
        const npmNames = REGISTRY.filter((p) => Object.keys(p.bins).length > 0).map((p) => p.npm);
        const cmd = `bun install -g ${npmNames.join(" ")} 2>&1`;
        const result = execSafe(cmd, 120000);
        if (result) {
          console.log(source_default.green("  Packages installed successfully."));
        } else {
          console.log(source_default.yellow("  Some packages may have failed to install. Run 'hasna update' to retry."));
        }
      }
    }
    console.log(source_default.bold(`
Done! Run 'hasna doctor' to verify your setup.`));
  });
}

// src/commands/update.ts
function gatherUpdateInfo(pkgNames) {
  const packages = pkgNames ? pkgNames.map((n) => findPackage(n)).filter(Boolean) : REGISTRY.filter((p) => Object.keys(p.bins).length > 0);
  const infos = [];
  for (const pkg of packages) {
    const current = getInstalledVersion(pkg.npm);
    if (!current)
      continue;
    const latest = getLatestVersion(pkg.npm);
    infos.push({
      name: pkg.name,
      npm: pkg.npm,
      current,
      latest: latest || current,
      needsUpdate: !!latest && latest !== current
    });
  }
  return infos;
}
function registerUpdateCommand(program2) {
  program2.command("update [packages...]").description("Update @hasna/* packages. No args = update all installed. --check = dry run.").option("--check", "Dry run \u2014 show what would be updated without installing").option("--force", "Force reinstall even if version matches").action((packages, opts) => {
    const specific = packages.length > 0 ? packages : undefined;
    if (specific) {
      for (const name of specific) {
        if (!findPackage(name)) {
          console.error(source_default.red(`Unknown package: ${name}`));
          console.log(source_default.dim(`Available: ${REGISTRY.map((p) => p.name).join(", ")}`));
          process.exit(1);
        }
      }
    }
    console.log(source_default.bold("hasna update") + source_default.dim(` \u2014 checking for updates...
`));
    const infos = gatherUpdateInfo(specific);
    if (infos.length === 0) {
      if (specific) {
        console.log(source_default.yellow("Specified packages are not installed. Install them first with 'hasna init'."));
      } else {
        console.log(source_default.yellow("No @hasna/* packages installed. Run 'hasna init' first."));
      }
      return;
    }
    const updatable = infos.filter((i) => i.needsUpdate);
    console.log(source_default.bold(pad("Package", 22) + pad("Current", 14) + pad("Latest", 14) + pad("Status", 12)));
    console.log(source_default.dim("\u2500".repeat(62)));
    for (const info of infos) {
      const status = info.needsUpdate ? source_default.yellow("update available") : source_default.green("up to date");
      console.log(pad(info.name, 22) + pad(info.current, 14) + pad(info.latest, 14) + status);
    }
    console.log();
    if (opts.check) {
      if (updatable.length === 0) {
        console.log(source_default.green("All packages are up to date."));
      } else {
        console.log(source_default.yellow(`${updatable.length} package(s) can be updated.`));
        console.log(source_default.dim("Run 'hasna update' without --check to install updates."));
      }
      return;
    }
    const toUpdate = opts.force ? infos : updatable;
    if (toUpdate.length === 0) {
      console.log(source_default.green("All packages are up to date."));
      return;
    }
    console.log(source_default.dim(`Updating ${toUpdate.length} package(s)...
`));
    let succeeded = 0;
    let failed = 0;
    for (const info of toUpdate) {
      process.stdout.write(source_default.dim(`  ${info.npm}@${info.latest} ... `));
      const result = execSafe(`bun install -g ${info.npm}@latest 2>&1`, 60000);
      if (result !== null) {
        console.log(source_default.green("ok"));
        succeeded++;
      } else {
        console.log(source_default.red("failed"));
        failed++;
      }
    }
    console.log();
    console.log(source_default.bold(`${source_default.green(`${succeeded} updated`)}, ${source_default.red(`${failed} failed`)}`));
  });
}

// src/commands/sync.ts
function registerSyncCommand(program2) {
  const syncCmd = program2.command("sync").description("Sync local SQLite databases with remote PostgreSQL via @hasna/cloud");
  syncCmd.command("status").description("Show sync status for all packages").option("-f, --filter <name>", "Filter by package name").action((opts) => {
    console.log(source_default.bold(`hasna sync status
`));
    const rdsHost = process.env.HASNA_RDS_HOST || process.env.CLOUD_PG_HOST;
    if (!rdsHost) {
      console.log(source_default.yellow("No RDS configured. Set HASNA_RDS_HOST or run 'hasna init'."));
      return;
    }
    let packages = dbPackages();
    if (opts.filter) {
      const f = opts.filter.toLowerCase();
      packages = packages.filter((p) => p.name.toLowerCase().includes(f));
    }
    console.log(pad("Package", 18) + pad("Local DB", 12) + pad("CLI", 10) + pad("Sync Ready", 12));
    console.log(source_default.dim("\u2500".repeat(52)));
    for (const pkg of packages) {
      const dp = dataPath(pkg.dataDir);
      const hasLocal = dirExists(dp);
      const hasCli = pkg.bins.cli ? binaryExists(pkg.bins.cli) : false;
      const syncReady = hasLocal && hasCli;
      console.log(pad(pkg.name, 18) + pad(hasLocal ? source_default.green("ok") : source_default.red("missing"), 12) + pad(hasCli ? source_default.green("ok") : source_default.red("missing"), 10) + pad(syncReady ? source_default.green("ready") : source_default.yellow("not ready"), 12));
    }
    console.log(source_default.dim(`
RDS: ${rdsHost}`));
  });
  syncCmd.command("push [packages...]").description("Push local data to remote PostgreSQL").action((packages) => {
    const rdsHost = process.env.HASNA_RDS_HOST || process.env.CLOUD_PG_HOST;
    if (!rdsHost) {
      console.error(source_default.red("No RDS configured. Set HASNA_RDS_HOST or run 'hasna init'."));
      process.exit(1);
    }
    const targets = packages.length > 0 ? packages.map((n) => findPackage(n)).filter(Boolean) : dbPackages().filter((p) => p.bins.cli && binaryExists(p.bins.cli));
    if (targets.length === 0) {
      console.log(source_default.yellow("No syncable packages found. Install packages first."));
      return;
    }
    console.log(source_default.bold("hasna sync push") + source_default.dim(` \u2014 pushing ${targets.length} packages
`));
    for (const pkg of targets) {
      if (!pkg.bins.cli)
        continue;
      process.stdout.write(source_default.dim(`  ${pkg.name} ... `));
      const result = execSafe(`${pkg.bins.cli} sync push 2>&1`, 30000);
      if (result !== null) {
        console.log(source_default.green("ok"));
      } else {
        console.log(source_default.yellow("skipped (sync not supported or failed)"));
      }
    }
  });
  syncCmd.command("pull [packages...]").description("Pull remote data to local SQLite").action((packages) => {
    const rdsHost = process.env.HASNA_RDS_HOST || process.env.CLOUD_PG_HOST;
    if (!rdsHost) {
      console.error(source_default.red("No RDS configured. Set HASNA_RDS_HOST or run 'hasna init'."));
      process.exit(1);
    }
    const targets = packages.length > 0 ? packages.map((n) => findPackage(n)).filter(Boolean) : dbPackages().filter((p) => p.bins.cli && binaryExists(p.bins.cli));
    if (targets.length === 0) {
      console.log(source_default.yellow("No syncable packages found. Install packages first."));
      return;
    }
    console.log(source_default.bold("hasna sync pull") + source_default.dim(` \u2014 pulling ${targets.length} packages
`));
    for (const pkg of targets) {
      if (!pkg.bins.cli)
        continue;
      process.stdout.write(source_default.dim(`  ${pkg.name} ... `));
      const result = execSafe(`${pkg.bins.cli} sync pull 2>&1`, 30000);
      if (result !== null) {
        console.log(source_default.green("ok"));
      } else {
        console.log(source_default.yellow("skipped (sync not supported or failed)"));
      }
    }
  });
}

// src/commands/mcp.ts
async function checkMcp(pkg) {
  const binary = pkg.bins.mcp;
  const installed = binaryExists(binary);
  if (!installed) {
    return { name: pkg.name, binary, installed: false, starts: false, error: "not on PATH" };
  }
  const result = await spawnWithTimeout(binary, ["--help"], 3000);
  const starts = result.code === 0;
  return {
    name: pkg.name,
    binary,
    installed: true,
    starts,
    error: !starts ? result.timedOut ? "timeout (no response within 3s)" : result.stderr.split(`
`)[0] || `exit ${result.code ?? "spawn error"}` : undefined
  };
}
function registerMcpCommand(program2) {
  const mcpCmd = program2.command("mcp").description("Manage MCP servers across all @hasna/* packages");
  mcpCmd.command("check").description("Spawn each MCP binary (3s timeout), check for errors, report table").option("-f, --filter <name>", "Filter by package name").action(async (opts) => {
    let packages = mcpPackages();
    if (opts.filter) {
      const f = opts.filter.toLowerCase();
      packages = packages.filter((p) => p.name.toLowerCase().includes(f));
    }
    console.log(source_default.bold("hasna mcp check") + source_default.dim(` \u2014 testing ${packages.length} MCP servers
`));
    const results = [];
    for (const pkg of packages) {
      process.stdout.write(source_default.dim(`  Checking ${pkg.name}...`));
      const result = await checkMcp(pkg);
      results.push(result);
      process.stdout.write("\r" + " ".repeat(60) + "\r");
    }
    console.log(source_default.bold(pad("Package", 18) + pad("Binary", 22) + pad("Installed", 12) + pad("Starts", 10) + "Error"));
    console.log(source_default.dim("\u2500".repeat(80)));
    let passCount = 0;
    let failCount = 0;
    for (const r of results) {
      const installedStr = r.installed ? source_default.green("yes") : source_default.red("no");
      const startsStr = r.starts ? source_default.green("yes") : source_default.red("no");
      const errorStr = r.error ? source_default.red(r.error) : "";
      console.log(pad(r.name, 18) + pad(r.binary, 22) + pad(installedStr, 12) + pad(startsStr, 10) + errorStr);
      if (r.installed && r.starts)
        passCount++;
      else
        failCount++;
    }
    console.log();
    console.log(`  ${source_default.green(`${passCount} ok`)}, ${source_default.red(`${failCount} issues`)} out of ${results.length} MCP servers`);
    if (failCount > 0) {
      process.exitCode = 1;
    }
  });
  mcpCmd.command("list").description("List all known MCP server binaries").action(() => {
    const packages = mcpPackages();
    console.log(source_default.bold(`MCP Servers
`));
    console.log(pad("Package", 18) + pad("Binary", 22) + pad("Installed", 10));
    console.log(source_default.dim("\u2500".repeat(50)));
    for (const pkg of packages) {
      const binary = pkg.bins.mcp;
      const installed = binaryExists(binary);
      console.log(pad(pkg.name, 18) + pad(binary, 22) + (installed ? source_default.green("yes") : source_default.red("no")));
    }
  });
}

// src/commands/backup.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync3, readdirSync as readdirSync2, statSync as statSync2 } from "fs";
import { join as join3, resolve as resolve2 } from "path";
var BACKUP_DIR = join3(HASNA_HOME, "backups");
function ensureBackupDir() {
  if (!dirExists(BACKUP_DIR)) {
    mkdirSync3(BACKUP_DIR, { recursive: true });
  }
}
function generateBackupName() {
  const now = new Date;
  const ts = now.toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  return `hasna-backup-${ts}.tar.gz`;
}
function registerBackupCommand(program2) {
  const backupCmd = program2.command("backup").description("Back up and restore ~/.hasna data");
  backupCmd.command("create").alias("run").description("Create a tarball backup of ~/.hasna (excluding backups dir)").option("-o, --output <path>", "Output path for the backup file").action((opts) => {
    if (!dirExists(HASNA_HOME)) {
      console.error(source_default.red("~/.hasna does not exist. Run 'hasna init' first."));
      process.exit(1);
    }
    ensureBackupDir();
    const filename = generateBackupName();
    const outputPath = opts.output ? resolve2(opts.output) : join3(BACKUP_DIR, filename);
    console.log(source_default.bold(`hasna backup create
`));
    console.log(source_default.dim(`  Source: ${HASNA_HOME}`));
    console.log(source_default.dim(`  Output: ${outputPath}
`));
    const result = spawnSafe("tar", ["-czf", outputPath, "-h", "-C", HASNA_HOME, "--exclude=backups", "."], 120000);
    if (result !== null && existsSync3(outputPath)) {
      const size = statSync2(outputPath).size;
      console.log(source_default.green(`  Backup created: ${outputPath} (${formatBytes(size)})`));
    } else {
      console.error(source_default.red(`  Backup failed: ${result || "unknown error"}`));
      process.exit(1);
    }
  });
  backupCmd.command("restore <file>").description("Restore a backup tarball into ~/.hasna").option("--dry-run", "Show what would be restored without actually restoring").action((file, opts) => {
    const filePath = resolve2(file);
    if (!existsSync3(filePath)) {
      console.error(source_default.red(`Backup file not found: ${filePath}`));
      process.exit(1);
    }
    console.log(source_default.bold(`hasna backup restore
`));
    console.log(source_default.dim(`  Source: ${filePath}`));
    console.log(source_default.dim(`  Target: ${HASNA_HOME}
`));
    const listing = listTarball(filePath, 30);
    if (listing === null) {
      console.error(source_default.red(`  Invalid or unreadable backup archive: ${filePath}`));
      console.error(source_default.red("  Refusing to restore from an unverified archive."));
      process.exit(1);
    }
    if (opts.dryRun) {
      console.log(source_default.dim("  Files (first 30):"));
      for (const line of listing.split(`
`).filter(Boolean)) {
        console.log(source_default.dim(`    ${line}`));
      }
      console.log(source_default.yellow(`
  Dry run \u2014 no changes made.`));
      return;
    }
    const staging = execSafe(`mktemp -d /tmp/hasna-restore.XXXXXX`, 5000);
    if (staging === null) {
      console.error(source_default.red("  Restore failed: could not create staging directory."));
      process.exit(1);
    }
    try {
      const extractResult = spawnSafe("tar", ["-xzf", filePath, "-C", staging], 120000);
      if (extractResult === null) {
        console.error(source_default.red("  Restore failed: archive extraction into staging failed."));
        console.error(source_default.red(`  Live data untouched. Staging: ${staging}`));
        process.exit(1);
      }
      const outcome = copyStagedWithRollback(staging, HASNA_HOME);
      if (outcome.warning) {
        console.error(source_default.yellow(`  ${outcome.warning}`));
      }
      if (outcome.ok) {
        console.log(source_default.green("  Restore complete."));
      } else if (outcome.copyApplied) {
        console.error(source_default.red("  Restore applied, but the pre-copy snapshot could not be removed."));
        console.error(source_default.red(`  Sensitive pre-copy snapshot retained at: ${outcome.snapshot}`));
        console.error(source_default.red("  Remove it manually once the restored data is verified."));
        process.exit(1);
      } else if (outcome.rolledBack) {
        console.error(source_default.red("  Restore failed: copying staged content into ~/.hasna failed."));
        console.error(source_default.red("  Live data was rolled back to the pre-copy state."));
        if (outcome.snapshot) {
          console.error(source_default.red(`  Pre-copy snapshot retained at: ${outcome.snapshot}`));
        }
        if (outcome.retainedSwap) {
          console.error(source_default.red(`  Displaced live tree retained at: ${outcome.retainedSwap}`));
        }
        process.exit(1);
      } else {
        console.error(source_default.red("  Restore failed: copying staged content into ~/.hasna failed."));
        if (outcome.snapshot) {
          console.error(source_default.red(`  Rollback could not complete. Pre-copy snapshot preserved at: ${outcome.snapshot}`));
        } else {
          console.error(source_default.red("  No pre-copy snapshot could be taken; live data may be partially restored."));
        }
        if (outcome.retainedSwap) {
          console.error(source_default.red(`  Displaced live tree retained at: ${outcome.retainedSwap}`));
        }
        console.error(source_default.red(`  Staged copy preserved at: ${staging}`));
        process.exit(1);
      }
    } finally {
      const cleanup = execSafe(`rm -rf "${staging}" 2>&1`, 5000);
      if (cleanup === null) {
        console.error(source_default.yellow(`  Warning: could not remove staging dir: ${staging}`));
      }
    }
  });
  backupCmd.command("list").description("List available backups in ~/.hasna/backups").action(() => {
    ensureBackupDir();
    console.log(source_default.bold(`hasna backup list
`));
    let files;
    try {
      files = readdirSync2(BACKUP_DIR).filter((f) => f.endsWith(".tar.gz")).sort().reverse();
    } catch {
      files = [];
    }
    if (files.length === 0) {
      console.log(source_default.dim("  No backups found."));
      console.log(source_default.dim(`  Run 'hasna backup create' to create one.`));
      return;
    }
    for (const file of files) {
      const full = join3(BACKUP_DIR, file);
      const size = statSync2(full).size;
      const mtime = statSync2(full).mtime.toISOString().slice(0, 19).replace("T", " ");
      console.log(`  ${source_default.cyan(file)}  ${formatBytes(size)}  ${source_default.dim(mtime)}`);
    }
    console.log(source_default.dim(`
  ${files.length} backup(s) in ${BACKUP_DIR}`));
  });
}

// src/commands/db.ts
import { readdirSync as readdirSync3, statSync as statSync3 } from "fs";
import { join as join4 } from "path";
function isSafeIdentifier(value) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}
function findDbFiles(pkg) {
  const dp = dataPath(pkg.dataDir);
  if (!dirExists(dp))
    return [];
  const files = [];
  try {
    const entries = readdirSync3(dp, { recursive: true });
    for (const entry of entries) {
      const full = join4(dp, String(entry));
      if ((full.endsWith(".db") || full.endsWith(".sqlite") || full.endsWith(".sqlite3")) && fileExists(full)) {
        files.push({ pkg: pkg.name, file: String(entry), path: full, size: statSync3(full).size });
      }
    }
  } catch {}
  return files;
}
function registerDbCommand(program2) {
  const dbCmd = program2.command("db").description("Manage SQLite databases across @hasna/* packages");
  dbCmd.command("check").description("Verify database files exist and are valid SQLite").option("-f, --filter <name>", "Filter by package name").action((opts) => {
    let packages = dbPackages();
    if (opts.filter) {
      const f = opts.filter.toLowerCase();
      packages = packages.filter((p) => p.name.toLowerCase().includes(f));
    }
    console.log(source_default.bold("hasna db check") + source_default.dim(` \u2014 verifying databases
`));
    let totalFiles = 0;
    let validFiles = 0;
    let corruptFiles = 0;
    for (const pkg of packages) {
      const files = findDbFiles(pkg);
      if (files.length === 0)
        continue;
      for (const f of files) {
        totalFiles++;
        const result = spawnSafe("sqlite3", [f.path, "PRAGMA integrity_check;"], 1e4);
        if (result && result.includes("ok")) {
          validFiles++;
          console.log(`  ${source_default.green("[OK]")} ${pad(f.pkg, 16)} ${f.file} ${source_default.dim(`(${formatBytes(f.size)})`)}`);
        } else {
          corruptFiles++;
          console.log(`  ${source_default.red("[CORRUPT]")} ${pad(f.pkg, 16)} ${f.file} ${source_default.dim(`(${formatBytes(f.size)})`)}`);
        }
      }
    }
    if (totalFiles === 0) {
      console.log(source_default.dim("  No database files found."));
      return;
    }
    console.log();
    console.log(`  ${source_default.green(`${validFiles} valid`)}, ${source_default.red(`${corruptFiles} corrupt`)} out of ${totalFiles} databases`);
  });
  dbCmd.command("stats").description("Show row counts and sizes for all databases").option("-f, --filter <name>", "Filter by package name").action((opts) => {
    let packages = dbPackages();
    if (opts.filter) {
      const f = opts.filter.toLowerCase();
      packages = packages.filter((p) => p.name.toLowerCase().includes(f));
    }
    console.log(source_default.bold(`hasna db stats
`));
    console.log(source_default.bold(pad("Package", 18) + pad("File", 24) + pad("Size", 12) + pad("Tables", 8) + "Rows"));
    console.log(source_default.dim("\u2500".repeat(76)));
    let totalSize = 0;
    let totalRows = 0;
    for (const pkg of packages) {
      const files = findDbFiles(pkg);
      if (files.length === 0)
        continue;
      for (const f of files) {
        totalSize += f.size;
        const tablesRaw = spawnSafe("sqlite3", [f.path, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"]);
        const tables = tablesRaw ? tablesRaw.split(`
`).filter(Boolean).filter(isSafeIdentifier) : [];
        let rowCount = 0;
        for (const table of tables) {
          const countRaw = spawnSafe("sqlite3", [f.path, `SELECT COUNT(*) FROM "${table}";`]);
          if (countRaw) {
            rowCount += parseInt(countRaw, 10) || 0;
          }
        }
        totalRows += rowCount;
        console.log(pad(f.pkg, 18) + pad(f.file, 24) + pad(formatBytes(f.size), 12) + pad(String(tables.length), 8) + String(rowCount));
      }
    }
    console.log(source_default.dim("\u2500".repeat(76)));
    console.log(source_default.bold(pad("Total", 18) + pad("", 24) + pad(formatBytes(totalSize), 12) + pad("", 8) + String(totalRows)));
  });
  dbCmd.command("vacuum [packages...]").description("Run VACUUM on databases to reclaim space").action((packages) => {
    const targets = packages.length > 0 ? dbPackages().filter((p) => packages.includes(p.name)) : dbPackages();
    console.log(source_default.bold(`hasna db vacuum
`));
    let vacuumed = 0;
    for (const pkg of targets) {
      const files = findDbFiles(pkg);
      for (const f of files) {
        const sizeBefore = f.size;
        const result = spawnSafe("sqlite3", [f.path, "VACUUM;"], 30000);
        if (result !== null) {
          const sizeAfter = statSync3(f.path).size;
          const saved = sizeBefore - sizeAfter;
          console.log(`  ${source_default.green("[OK]")} ${f.pkg}/${f.file}: ${formatBytes(sizeBefore)} -> ${formatBytes(sizeAfter)}` + (saved > 0 ? source_default.green(` (saved ${formatBytes(saved)})`) : source_default.dim(" (no change)")));
          vacuumed++;
        } else {
          console.log(`  ${source_default.red("[FAIL]")} ${f.pkg}/${f.file}`);
        }
      }
    }
    if (vacuumed === 0) {
      console.log(source_default.dim("  No databases found to vacuum."));
    }
  });
}

// src/commands/connect.ts
import { existsSync as existsSync4, mkdirSync as mkdirSync4, readFileSync as readFileSync3, writeFileSync as writeFileSync3, copyFileSync, renameSync as renameSync2, statSync as statSync4, openSync, closeSync, fsyncSync, chmodSync as chmodSync2 } from "fs";
import { dirname as dirname2, join as join5 } from "path";
import { homedir as homedir2 } from "os";

// ../../node_modules/.bun/smol-toml@1.8.0/node_modules/smol-toml/dist/date.js
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
var DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})?[T ]?(?:(\d{2}):\d{2}(?::\d{2}(?:\.\d+)?)?)?(Z|[-+]\d{2}:\d{2})?$/i;

class TomlDate extends Date {
  #hasDate = false;
  #hasTime = false;
  #offset = null;
  constructor(date) {
    let hasDate = true;
    let hasTime = true;
    let offset = "Z";
    if (typeof date === "string") {
      let match = date.match(DATE_TIME_RE);
      if (match) {
        if (!match[1]) {
          hasDate = false;
          date = `0000-01-01T${date}`;
        }
        hasTime = !!match[2];
        hasTime && date[10] === " " && (date = date.replace(" ", "T"));
        if (match[2] && +match[2] > 23) {
          date = "";
        } else {
          offset = match[3] || null;
          date = date.toUpperCase();
          if (!offset && hasTime)
            date += "Z";
        }
      } else {
        date = "";
      }
    }
    super(date);
    if (!isNaN(this.getTime())) {
      this.#hasDate = hasDate;
      this.#hasTime = hasTime;
      this.#offset = offset;
    }
  }
  isDateTime() {
    return this.#hasDate && this.#hasTime;
  }
  isLocal() {
    return !this.#hasDate || !this.#hasTime || !this.#offset;
  }
  isDate() {
    return this.#hasDate && !this.#hasTime;
  }
  isTime() {
    return this.#hasTime && !this.#hasDate;
  }
  isValid() {
    return this.#hasDate || this.#hasTime;
  }
  toISOString() {
    let iso = super.toISOString();
    if (this.isDate())
      return iso.slice(0, 10);
    if (this.isTime())
      return iso.slice(11, 23);
    if (this.#offset === null)
      return iso.slice(0, -1);
    if (this.#offset === "Z")
      return iso;
    let offset = +this.#offset.slice(1, 3) * 60 + +this.#offset.slice(4, 6);
    offset = this.#offset[0] === "-" ? offset : -offset;
    let offsetDate = new Date(this.getTime() - offset * 60000);
    return offsetDate.toISOString().slice(0, -1) + this.#offset;
  }
  static wrapAsOffsetDateTime(jsDate, offset = "Z") {
    let date = new TomlDate(jsDate);
    date.#offset = offset;
    return date;
  }
  static wrapAsLocalDateTime(jsDate) {
    let date = new TomlDate(jsDate);
    date.#offset = null;
    return date;
  }
  static wrapAsLocalDate(jsDate) {
    let date = new TomlDate(jsDate);
    date.#hasTime = false;
    date.#offset = null;
    return date;
  }
  static wrapAsLocalTime(jsDate) {
    let date = new TomlDate(jsDate);
    date.#hasDate = false;
    date.#offset = null;
    return date;
  }
}

// ../../node_modules/.bun/smol-toml@1.8.0/node_modules/smol-toml/dist/error.js
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
function getLineColFromPtr(string, ptr) {
  let lines = string.slice(0, ptr).split(/\r\n|\n|\r/g);
  return [lines.length, lines.pop().length + 1];
}
function makeCodeBlock(string, line, column) {
  let lines = string.split(/\r\n|\n|\r/g);
  let codeblock = "";
  let numberLen = (Math.log10(line + 1) | 0) + 1;
  for (let i = line - 1;i <= line + 1; i++) {
    let l = lines[i - 1];
    if (!l)
      continue;
    codeblock += i.toString().padEnd(numberLen, " ");
    codeblock += ":  ";
    codeblock += l;
    codeblock += `
`;
    if (i === line) {
      codeblock += " ".repeat(numberLen + column + 2);
      codeblock += `^
`;
    }
  }
  return codeblock;
}

class TomlError extends Error {
  line;
  column;
  codeblock;
  constructor(message, options) {
    const [line, column] = getLineColFromPtr(options.toml, options.ptr);
    const codeblock = makeCodeBlock(options.toml, line, column);
    super(`Invalid TOML document: ${message}

${codeblock}`, options);
    this.line = line;
    this.column = column;
    this.codeblock = codeblock;
  }
}

// ../../node_modules/.bun/smol-toml@1.8.0/node_modules/smol-toml/dist/util.js
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
function indexOfNewline(str, start = 0) {
  let idx = str.indexOf(`
`, start);
  if (str.charCodeAt(idx - 1) === 13)
    idx--;
  return idx;
}
function skipComment(ctx) {
  for (;ctx.p < ctx.s.length; ctx.p++) {
    let c = ctx.s.charCodeAt(ctx.p);
    if (c === 10)
      break;
    if (c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10) {
      ctx.p++;
      break;
    }
    if (c < 32 && c !== 9 || c === 127) {
      throw new TomlError("control characters are not allowed in comments", {
        toml: ctx.s,
        ptr: ctx.p
      });
    }
  }
}
function skipVoid(ctx, banNewLines, banComments) {
  let c;
  while (true) {
    while ((c = ctx.s.charCodeAt(ctx.p)) === 32 || c === 9 || !banNewLines && (c === 10 || c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10))
      ctx.p++;
    if (banComments || c !== 35)
      break;
    skipComment(ctx);
  }
}
function skipUntil(ctx, sep, end) {
  let ptr = ctx.p;
  if (!end) {
    ptr = indexOfNewline(ctx.s, ptr);
    ctx.p = ptr < 0 ? ctx.s.length : ptr;
    return;
  }
  for (;ctx.p < ctx.s.length; ctx.p++) {
    let c = ctx.s.charCodeAt(ctx.p);
    if (c === 35) {
      skipComment(ctx);
    } else if (c === end || c === sep) {
      return;
    }
  }
  throw new TomlError("cannot find end of structure", {
    toml: ctx.s,
    ptr
  });
}

// ../../node_modules/.bun/smol-toml@1.8.0/node_modules/smol-toml/dist/primitive.js
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
var INT_REGEX = /^((0x[0-9a-fA-F](_?[0-9a-fA-F])*)|(([+-]|0[ob])?\d(_?\d)*))$/;
var FLOAT_REGEX = /^[+-]?\d(_?\d)*(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?$/;
var LEADING_ZERO = /^[+-]?0[0-9_]/;
function parseString(ctx) {
  let start = ctx.p;
  let c = ctx.s.charCodeAt(ctx.p++);
  let first = c;
  let isLiteral = c === 39;
  let isMultiline = c === ctx.s.charCodeAt(ctx.p) && c === ctx.s.charCodeAt(ctx.p + 1);
  if (isMultiline) {
    if ((c = ctx.s.charCodeAt(ctx.p += 2)) === 10)
      ctx.p++;
    else if (c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10)
      ctx.p += 2;
  }
  let parsed = "";
  let sliceStart = ctx.p;
  let state = 0;
  for (;ctx.p < ctx.s.length; ctx.p++) {
    c = ctx.s.charCodeAt(ctx.p);
    if (isMultiline && (c === 10 || c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10)) {
      state = state && 3;
    } else if (c < 32 && c !== 9 || c === 127) {
      throw new TomlError("control characters are not allowed in strings", {
        toml: ctx.s,
        ptr: ctx.p
      });
    } else if ((!state || state === 3) && c === first && (!isMultiline || ctx.s.charCodeAt(ctx.p + 1) === first && ctx.s.charCodeAt(ctx.p + 2) === first)) {
      if (isMultiline) {
        if (ctx.s.charCodeAt(ctx.p + 3) === first)
          ctx.p++;
        if (ctx.s.charCodeAt(ctx.p + 3) === first)
          ctx.p++;
      }
      if (!state)
        parsed += ctx.s.slice(sliceStart, ctx.p);
      ctx.p += isMultiline ? 3 : 1;
      return parsed;
    } else if (!state) {
      if (!isLiteral && c === 92) {
        parsed += ctx.s.slice(sliceStart, sliceStart = ctx.p);
        state = 1;
      }
    } else if (state === 1) {
      if (c === 120 || c === 117 || c === 85) {
        let value = 0;
        let len = c === 120 ? 2 : c === 117 ? 4 : 8;
        for (let j = 0;j < len; j++, ctx.p++) {
          let hex = ctx.s.charCodeAt(ctx.p + 1);
          let digit = hex >= 48 && hex <= 57 ? hex - 48 : hex >= 65 && hex <= 70 ? hex - 65 + 10 : hex >= 97 && hex <= 102 ? hex - 97 + 10 : -1;
          if (digit < 0)
            throw new TomlError("invalid non-hex character in unicode escape", { toml: ctx.s, ptr: ctx.p + 1 });
          value = value << 4 | digit;
        }
        if (value < 0 || value > 1114111 || value >= 55296 && value <= 57343) {
          throw new TomlError("invalid unicode escape", { toml: ctx.s, ptr: ctx.p });
        }
        parsed += String.fromCodePoint(value);
        sliceStart = ctx.p + 1;
        state = 0;
      } else if (c === 32 || c === 9) {
        state = 2;
      } else {
        if (c === 98)
          parsed += "\b";
        else if (c === 116)
          parsed += "\t";
        else if (c === 110)
          parsed += `
`;
        else if (c === 102)
          parsed += "\f";
        else if (c === 114)
          parsed += "\r";
        else if (c === 101)
          parsed += "\x1B";
        else if (c === 34)
          parsed += '"';
        else if (c === 92)
          parsed += "\\";
        else
          throw new TomlError("unrecognized escape sequence", { toml: ctx.s, ptr: ctx.p });
        sliceStart = ctx.p + 1;
        state = 0;
      }
    } else if (c !== 32 && c !== 9) {
      if (state === 2) {
        throw new TomlError("invalid escape: only line-ending whitespace may be escaped", {
          toml: ctx.s,
          ptr: sliceStart
        });
      }
      state = !isLiteral && c === 92 ? 1 : 0;
      sliceStart = ctx.p;
    }
  }
  throw new TomlError("unfinished string", { toml: ctx.s, ptr: start });
}
function sliceAndTrimEndOf(ctx, start, end) {
  let value = ctx.s.slice(start, end);
  let commentIdx = value.indexOf("#");
  if (commentIdx > 0) {
    skipComment({ s: value, p: commentIdx, d: 0 });
    value = value.slice(0, commentIdx);
  }
  return value.trimEnd();
}
function parseValue(ctx, integersAsBigInt, end) {
  let ptr = ctx.p;
  let err = { toml: ctx.s, ptr };
  skipUntil(ctx, 44, end);
  let value = sliceAndTrimEndOf(ctx, ptr, ctx.p);
  if (!value)
    throw new TomlError("incomplete declaration: value expected", err);
  if (value === "-inf")
    return -Infinity;
  if (value === "inf" || value === "+inf")
    return Infinity;
  if (value === "nan" || value === "+nan" || value === "-nan")
    return NaN;
  if (value === "-0")
    return integersAsBigInt ? 0n : 0;
  let isInt = INT_REGEX.test(value);
  if (isInt || FLOAT_REGEX.test(value)) {
    if (LEADING_ZERO.test(value)) {
      throw new TomlError("leading zeroes are not allowed", err);
    }
    value = value.replace(/_/g, "");
    let numeric = +value;
    if (isNaN(numeric)) {
      throw new TomlError("invalid number", err);
    }
    if (isInt) {
      if ((isInt = !Number.isSafeInteger(numeric)) && !integersAsBigInt) {
        throw new TomlError("integer value cannot be represented losslessly", err);
      }
      if (isInt || integersAsBigInt === true)
        numeric = BigInt(value);
    }
    return numeric;
  }
  const date = new TomlDate(value);
  if (!date.isValid())
    throw new TomlError("invalid value", err);
  return date;
}

// ../../node_modules/.bun/smol-toml@1.8.0/node_modules/smol-toml/dist/extract.js
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
function extractValue(ctx, end, integersAsBigInt) {
  let ptr = ctx.p;
  let c = ctx.s.charCodeAt(ptr);
  if (c === 91 || c === 123) {
    if (!ctx.d--) {
      throw new TomlError("document contains excessively nested structures. aborting.", {
        toml: ctx.s,
        ptr
      });
    }
    let value = c === 91 ? parseArray(ctx, integersAsBigInt) : parseInlineTable(ctx, integersAsBigInt);
    ctx.d++;
    return value;
  }
  if (c === 34 || c === 39) {
    return parseString(ctx);
  }
  if (c === 116) {
    if (ctx.s.charCodeAt(++ctx.p) !== 114 || ctx.s.charCodeAt(++ctx.p) !== 117 || ctx.s.charCodeAt(++ctx.p) !== 101)
      throw new TomlError("invalid value", { toml: ctx.s, ptr });
    ctx.p++;
    return true;
  }
  if (c === 102) {
    if (ctx.s.charCodeAt(++ctx.p) !== 97 || ctx.s.charCodeAt(++ctx.p) !== 108 || ctx.s.charCodeAt(++ctx.p) !== 115 || ctx.s.charCodeAt(++ctx.p) !== 101)
      throw new TomlError("invalid value", { toml: ctx.s, ptr });
    ctx.p++;
    return false;
  }
  return parseValue(ctx, integersAsBigInt, end);
}

// ../../node_modules/.bun/smol-toml@1.8.0/node_modules/smol-toml/dist/struct.js
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
var KEY_PART_RE = /^[a-zA-Z0-9-_]+[ \t]*$/;
function parseKey(ctx, end = "=") {
  let start = ctx.p;
  let dot = start - 1;
  let parsed = [];
  let endPtr = ctx.s.indexOf(end, start);
  if (endPtr < 0) {
    throw new TomlError("incomplete key-value: cannot find end of key", {
      toml: ctx.s,
      ptr: start
    });
  }
  do {
    let c = ctx.s.charCodeAt(ctx.p = ++dot);
    if (c !== 32 && c !== 9) {
      if (c === 34 || c === 39) {
        if (c === ctx.s.charCodeAt(ctx.p + 1) && c === ctx.s.charCodeAt(ctx.p + 2)) {
          throw new TomlError("multiline strings are not allowed in keys", {
            toml: ctx.s,
            ptr: ctx.p
          });
        }
        let part = parseString(ctx);
        dot = ctx.s.indexOf(".", ctx.p);
        let strEnd = ctx.s.slice(ctx.p, dot < 0 || dot > endPtr ? endPtr : dot);
        let newLine = indexOfNewline(strEnd);
        if (newLine > -1) {
          throw new TomlError("newlines are not allowed in keys", {
            toml: ctx.s,
            ptr: newLine
          });
        }
        if (strEnd.trimStart()) {
          throw new TomlError("found extra tokens after the string part", {
            toml: ctx.s,
            ptr: ctx.p
          });
        }
        if (endPtr < ctx.p) {
          endPtr = ctx.s.indexOf(end, ctx.p);
          if (endPtr < 0) {
            throw new TomlError("incomplete key-value: cannot find end of key", {
              toml: ctx.s,
              ptr: start
            });
          }
        }
        parsed.push(part);
      } else {
        dot = ctx.s.indexOf(".", ctx.p);
        let part = ctx.s.slice(ctx.p, dot < 0 || dot > endPtr ? endPtr : dot);
        if (!KEY_PART_RE.test(part)) {
          throw new TomlError("only letter, numbers, dashes and underscores are allowed in keys", {
            toml: ctx.s,
            ptr: ctx.p
          });
        }
        parsed.push(part.trimEnd());
      }
    }
  } while (dot + 1 && dot < endPtr);
  ctx.p = endPtr + 1;
  skipVoid(ctx, true, true);
  return parsed;
}
function parseInlineTable(ctx, integersAsBigInt) {
  let res = {};
  let seen = new Set;
  let c;
  ctx.p++;
  while (ctx.p < ctx.s.length) {
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p)) === 125) {
      ctx.p++;
      return res;
    }
    let k;
    let t = res;
    let hasOwn = false;
    let p = ctx.p;
    let key = parseKey(ctx);
    for (let i = 0;i < key.length; i++) {
      if (i)
        t = hasOwn ? t[k] : t[k] = {};
      k = key[i];
      if ((hasOwn = Object.hasOwn(t, k)) && (typeof t[k] !== "object" || seen.has(t[k]))) {
        throw new TomlError("trying to redefine an already defined value", {
          toml: ctx.s,
          ptr: p
        });
      }
      if (!hasOwn && k === "__proto__") {
        Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
      }
    }
    if (hasOwn) {
      throw new TomlError("trying to redefine an already defined value", {
        toml: ctx.s,
        ptr: ctx.p
      });
    }
    let value = extractValue(ctx, 125, integersAsBigInt);
    seen.add(t[k] = value);
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p++)) === 125) {
      return res;
    }
    if (c !== 44) {
      throw new TomlError("expected comma or end of structure", { toml: ctx.s, ptr: ctx.p - 1 });
    }
  }
  throw new TomlError("unfinished table encountered", {
    toml: ctx.s,
    ptr: ctx.p
  });
}
function parseArray(ctx, integersAsBigInt) {
  let res = [];
  let c;
  ctx.p++;
  while (ctx.p < ctx.s.length) {
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p)) === 93) {
      ctx.p++;
      return res;
    }
    res.push(extractValue(ctx, 93, integersAsBigInt));
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p++)) === 93) {
      return res;
    }
    if (c !== 44) {
      throw new TomlError("expected comma or end of structure", { toml: ctx.s, ptr: ctx.p - 1 });
    }
  }
  throw new TomlError("unfinished array encountered", {
    toml: ctx.s,
    ptr: ctx.p
  });
}

// ../../node_modules/.bun/smol-toml@1.8.0/node_modules/smol-toml/dist/parse.js
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
function peekTable(key, table, meta, type) {
  let t = table;
  let m = meta;
  let k;
  let hasOwn = false;
  let state;
  for (let i = 0;i < key.length; i++) {
    if (i) {
      t = hasOwn ? t[k] : t[k] = {};
      m = (state = m[k]).c;
      if (type === 0 && (state.t === 1 || state.t === 2)) {
        return null;
      }
      if (state.t === 2) {
        let l = t.length - 1;
        t = t[l];
        m = m[l].c;
      }
    }
    k = key[i];
    if ((hasOwn = Object.hasOwn(t, k)) && m[k]?.t === 0 && m[k]?.d) {
      return null;
    }
    if (!hasOwn) {
      if (k === "__proto__") {
        Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
        Object.defineProperty(m, k, { enumerable: true, configurable: true, writable: true });
      }
      m[k] = {
        t: i < key.length - 1 && type === 2 ? 3 : type,
        d: false,
        i: 0,
        c: {}
      };
    }
  }
  state = m[k];
  if (state.t !== type && !(type === 1 && state.t === 3)) {
    return null;
  }
  if (type === 2) {
    if (!state.d) {
      state.d = true;
      t[k] = [];
    }
    t[k].push(t = {});
    state.c[state.i++] = state = { t: 1, d: false, i: 0, c: {} };
  }
  if (state.d) {
    return null;
  }
  state.d = true;
  if (type === 1) {
    t = hasOwn ? t[k] : t[k] = {};
  } else if (type === 0 && hasOwn) {
    return null;
  }
  return [k, t, state.c];
}
function parse(toml, { maxDepth = 1000, integersAsBigInt } = {}) {
  let ctx = { s: toml, p: 0, d: maxDepth };
  let res = {};
  let meta = {};
  let tmp;
  let tbl = res;
  let m = meta;
  skipVoid(ctx);
  while (ctx.p < toml.length) {
    if (toml.charCodeAt(ctx.p) === 91) {
      let isTableArray = toml.charCodeAt(++ctx.p) === 91;
      tmp = ctx.p += +isTableArray;
      let k = parseKey(ctx, "]");
      if (isTableArray) {
        if (toml.charCodeAt(ctx.p - 1) !== 93) {
          throw new TomlError("expected end of table declaration", {
            toml,
            ptr: ctx.p - 1
          });
        }
        ctx.p++;
      }
      let p = peekTable(k, res, meta, isTableArray ? 2 : 1);
      if (!p) {
        throw new TomlError("trying to redefine an already defined table or value", {
          toml,
          ptr: tmp
        });
      }
      m = p[2];
      tbl = p[1];
    } else {
      tmp = ctx.p;
      let k = parseKey(ctx);
      let p = peekTable(k, tbl, m, 0);
      if (!p) {
        throw new TomlError("trying to redefine an already defined table or value", {
          toml,
          ptr: tmp
        });
      }
      p[1][p[0]] = extractValue(ctx, undefined, integersAsBigInt);
    }
    skipVoid(ctx, true);
    if (ctx.p < toml.length && (tmp = toml.charCodeAt(ctx.p)) !== 10 && tmp !== 13) {
      throw new TomlError("each key-value declaration must be followed by an end-of-line", {
        toml,
        ptr: ctx.p
      });
    }
    skipVoid(ctx);
  }
  return res;
}

// ../../node_modules/.bun/smol-toml@1.8.0/node_modules/smol-toml/dist/stringify.js
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

// ../../node_modules/.bun/smol-toml@1.8.0/node_modules/smol-toml/dist/index.js
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

// src/commands/connect.ts
function failClosed(message) {
  console.error(source_default.red(message));
  process.exit(1);
}
var TOOL_CONFIGS = {
  claude: {
    label: "Claude Code",
    candidates: [
      { path: join5(homedir2(), ".claude", "settings.json"), format: "json", mode: "json" },
      { path: join5(homedir2(), ".claude", "mcp.json"), format: "json", mode: "json" },
      { path: join5(homedir2(), ".claude", ".mcp.json"), format: "json", mode: "json" }
    ]
  },
  codex: {
    label: "Codex CLI",
    candidates: [
      { path: join5(homedir2(), ".codex", "config.toml"), format: "toml", mode: "toml" },
      { path: join5(homedir2(), ".codex", "config.json"), format: "json", mode: "codex-json" }
    ]
  },
  gemini: {
    label: "Gemini CLI",
    candidates: [
      { path: join5(homedir2(), ".gemini", "settings.json"), format: "json", mode: "json" },
      { path: join5(homedir2(), ".gemini", "mcp-config.json"), format: "json", mode: "json" }
    ]
  }
};
var SUPPORTED_TOOLS = Object.keys(TOOL_CONFIGS);
function isToolName(value) {
  return value in TOOL_CONFIGS;
}
function formatTomlString(value) {
  return JSON.stringify(value);
}
function buildTomlServerBlock(name, entry) {
  const args = entry.args.map(formatTomlString).join(", ");
  return `[mcp_servers.${name}]
command = ${formatTomlString(entry.command)}
args = [${args}]
`;
}
function hasTomlServer(content, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\[mcp_servers\\.${escapedName}\\]\\s*$`, "m").test(content);
}
function resolveToolConfig(tool, pathExists = existsSync4) {
  const config = TOOL_CONFIGS[tool];
  const existing = config.candidates.find((candidate) => pathExists(candidate.path));
  const selected = existing ?? config.candidates[0];
  return { label: config.label, ...selected };
}
function buildMcpEntries(serviceNames, mode) {
  const entries = {};
  for (const name of serviceNames) {
    const pkg = REGISTRY.find((r) => r.name === name);
    if (!pkg?.bins?.mcp)
      continue;
    if (mode === "codex-json") {
      entries[name] = { type: "stdio", command: pkg.bins.mcp, args: [], env: {} };
      continue;
    }
    entries[name] = { command: pkg.bins.mcp, args: [] };
  }
  return entries;
}
function readJson(path) {
  if (!existsSync4(path))
    return {};
  let raw;
  try {
    raw = readFileSync3(path, "utf-8");
  } catch {
    failClosed(`Cannot read existing config ${path}; refusing to modify it.`);
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      failClosed(`Config ${path} is not a JSON object; refusing to overwrite it.`);
    }
    return parsed;
  } catch (err) {
    failClosed(`Cannot parse existing config ${path} (${err.message}); refusing to overwrite it.`);
  }
}
function readText(path) {
  if (!existsSync4(path))
    return "";
  let raw;
  try {
    raw = readFileSync3(path, "utf-8");
  } catch {
    failClosed(`Cannot read existing config ${path}; refusing to modify it.`);
  }
  try {
    parse(raw);
  } catch (err) {
    failClosed(`Config ${path} is not structurally valid TOML (${err.message}); refusing to modify it.`);
  }
  return raw;
}
function writeText(path, content) {
  mkdirSync4(dirname2(path), { recursive: true });
  let mode = 384;
  if (existsSync4(path)) {
    copyFileSync(path, `${path}.bak`);
    try {
      mode = statSync4(path).mode & 511;
    } catch {}
  }
  const tmp = `${path}.tmp-${process.pid}`;
  const fd = openSync(tmp, "w", mode);
  try {
    writeFileSync3(fd, content, "utf-8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync2(tmp, mode);
  renameSync2(tmp, path);
}
function writeJson(path, data) {
  writeText(path, JSON.stringify(data, null, 2) + `
`);
}
function mergeWithoutOverwrite(existing, incoming) {
  const merged = { ...existing };
  const added = [];
  const skipped = [];
  for (const [key, value] of Object.entries(incoming)) {
    if (key in merged) {
      skipped.push(key);
    } else {
      merged[key] = value;
      added.push(key);
    }
  }
  return { merged, added, skipped };
}
function mergeTomlMcpBlocks(existingContent, mcpEntries) {
  let merged = existingContent.trimEnd();
  const added = [];
  const skipped = [];
  for (const [name, entry] of Object.entries(mcpEntries)) {
    if (hasTomlServer(merged, name)) {
      skipped.push(name);
      continue;
    }
    merged = `${merged}${merged.length > 0 ? `

` : ""}${buildTomlServerBlock(name, entry)}`;
    added.push(name);
  }
  const finalContent = merged.length > 0 ? `${merged}
` : "";
  if (finalContent.trim().length > 0) {
    try {
      parse(finalContent);
    } catch (err) {
      failClosed(`Merged config failed structural TOML validation (${err.message}); refusing to write it.`);
    }
  }
  return { merged: finalContent, added, skipped };
}
function connectJsonTool(config, mcpEntries, dryRun) {
  const settings = readJson(config.path);
  if (settings.mcpServers !== undefined && (settings.mcpServers === null || typeof settings.mcpServers !== "object" || Array.isArray(settings.mcpServers))) {
    failClosed(`Config ${config.path}: "mcpServers" is not a plain object; refusing to modify it.`);
  }
  const existingServers = settings.mcpServers || {};
  const { merged, added, skipped } = mergeWithoutOverwrite(existingServers, mcpEntries);
  if (added.length === 0) {
    console.log(source_default.dim(`  ${config.label}: all ${Object.keys(mcpEntries).length} servers already configured`));
    if (skipped.length > 0) {
      console.log(source_default.dim(`  Skipped (already present): ${skipped.join(", ")}`));
    }
    return;
  }
  if (dryRun) {
    console.log(source_default.yellow(`  [dry-run] ${config.label}: would add ${added.length} MCP servers`));
    for (const name of added) {
      const entry = mcpEntries[name];
      console.log(source_default.dim(`    + ${name} \u2192 ${entry.command}`));
    }
    if (skipped.length > 0) {
      console.log(source_default.dim(`  Would skip (already present): ${skipped.join(", ")}`));
    }
    return;
  }
  settings.mcpServers = merged;
  writeJson(config.path, settings);
  console.log(source_default.green(`  ${config.label}: added ${added.length} MCP servers \u2192 ${config.path}`));
  for (const name of added) {
    const entry = mcpEntries[name];
    console.log(source_default.dim(`    + ${name} \u2192 ${entry.command}`));
  }
  if (skipped.length > 0) {
    console.log(source_default.dim(`  Skipped (already present): ${skipped.join(", ")}`));
  }
}
function connectTomlTool(config, mcpEntries, dryRun) {
  const existingContent = readText(config.path);
  const { merged, added, skipped } = mergeTomlMcpBlocks(existingContent, mcpEntries);
  if (added.length === 0) {
    console.log(source_default.dim(`  ${config.label}: all ${Object.keys(mcpEntries).length} servers already configured`));
    if (skipped.length > 0) {
      console.log(source_default.dim(`  Skipped (already present): ${skipped.join(", ")}`));
    }
    return;
  }
  if (dryRun) {
    console.log(source_default.yellow(`  [dry-run] ${config.label}: would add ${added.length} MCP servers`));
    for (const name of added) {
      const entry = mcpEntries[name];
      console.log(source_default.dim(`    + ${name} \u2192 ${entry.command}`));
    }
    if (skipped.length > 0) {
      console.log(source_default.dim(`  Would skip (already present): ${skipped.join(", ")}`));
    }
    return;
  }
  writeText(config.path, merged);
  console.log(source_default.green(`  ${config.label}: added ${added.length} MCP servers \u2192 ${config.path}`));
  for (const name of added) {
    const entry = mcpEntries[name];
    console.log(source_default.dim(`    + ${name} \u2192 ${entry.command}`));
  }
  if (skipped.length > 0) {
    console.log(source_default.dim(`  Skipped (already present): ${skipped.join(", ")}`));
  }
}
function registerConnectCommand(program2) {
  program2.command("connect <tool>").description("Auto-wire MCP servers into AI tool configs (claude, codex, gemini)").option("--only <services>", "Only connect specific services (comma-separated)").option("--dry-run", "Show what would be added without writing").action((tool, opts) => {
    if (!isToolName(tool)) {
      console.error(source_default.red(`Unknown tool: ${tool}`));
      console.error(source_default.dim(`Supported tools: ${SUPPORTED_TOOLS.join(", ")}`));
      process.exit(1);
    }
    const resolvedConfig = resolveToolConfig(tool);
    const allMcpNames = mcpPackages().map((p) => p.name);
    const serviceNames = opts.only ? opts.only.split(",").map((s) => s.trim()).filter(Boolean) : allMcpNames;
    const invalid = serviceNames.filter((s) => !allMcpNames.includes(s));
    if (invalid.length > 0) {
      console.error(source_default.red(`Unknown MCP services: ${invalid.join(", ")}`));
      console.error(source_default.dim(`Available: ${allMcpNames.join(", ")}`));
      process.exit(1);
    }
    const mcpEntries = buildMcpEntries(serviceNames, resolvedConfig.mode);
    const entryCount = Object.keys(mcpEntries).length;
    if (entryCount === 0) {
      console.log(source_default.yellow("No MCP servers found for the specified services."));
      return;
    }
    console.log(source_default.bold("agency connect") + source_default.dim(` \u2014 wiring ${entryCount} MCP servers into ${resolvedConfig.label}
`));
    console.log(source_default.dim(`  Target config: ${resolvedConfig.path}`));
    if (resolvedConfig.format === "toml") {
      connectTomlTool(resolvedConfig, mcpEntries, !!opts.dryRun);
    } else {
      connectJsonTool(resolvedConfig, mcpEntries, !!opts.dryRun);
    }
    if (!opts.dryRun) {
      console.log(source_default.bold(`
Done!`) + source_default.dim(" Restart your AI tool to pick up the changes."));
    }
  });
}

// src/commands/playground.ts
import { createInterface as createInterface2 } from "readline";
function readJsonRpcMessage(proc, timeoutMs = 1e4) {
  return new Promise((resolve3, reject) => {
    const reader = proc.stdout.getReader();
    let buffer = "";
    let done = false;
    const timer = setTimeout(() => {
      done = true;
      reader.releaseLock();
      reject(new Error("Timeout waiting for MCP server response"));
    }, timeoutMs);
    function read() {
      if (done)
        return;
      reader.read().then(({ value, done: streamDone }) => {
        if (done)
          return;
        if (streamDone) {
          clearTimeout(timer);
          done = true;
          reader.releaseLock();
          reject(new Error("MCP server closed stdout"));
          return;
        }
        buffer += new TextDecoder().decode(value);
        const lines = buffer.split(`
`);
        for (let i = 0;i < lines.length - 1; i++) {
          const line = lines[i].trim();
          if (!line)
            continue;
          try {
            const msg = JSON.parse(line);
            clearTimeout(timer);
            done = true;
            reader.releaseLock();
            resolve3(msg);
            return;
          } catch {}
        }
        buffer = lines[lines.length - 1];
        read();
      }).catch((err) => {
        if (!done) {
          clearTimeout(timer);
          done = true;
          reader.releaseLock();
          reject(err);
        }
      });
    }
    read();
  });
}
function sendJsonRpc(proc, msg) {
  const data = JSON.stringify(msg) + `
`;
  proc.stdin.write(data);
}
function prettyPrint(value, indent = 0) {
  const pad2 = " ".repeat(indent);
  if (value === null || value === undefined) {
    console.log(pad2 + source_default.dim("null"));
    return;
  }
  if (typeof value === "string") {
    if (value.length > 500) {
      console.log(pad2 + source_default.green(`"${value.slice(0, 500)}..."`));
    } else {
      console.log(pad2 + source_default.green(`"${value}"`));
    }
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    console.log(pad2 + source_default.yellow(String(value)));
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      console.log(pad2 + source_default.dim("[]"));
      return;
    }
    console.log(pad2 + "[");
    for (const item of value) {
      prettyPrint(item, indent + 2);
    }
    console.log(pad2 + "]");
    return;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      console.log(pad2 + source_default.dim("{}"));
      return;
    }
    console.log(pad2 + "{");
    for (const key of keys) {
      process.stdout.write(pad2 + "  " + source_default.cyan(key) + ": ");
      const v = value[key];
      if (typeof v === "object" && v !== null) {
        console.log();
        prettyPrint(v, indent + 4);
      } else if (typeof v === "string") {
        if (v.length > 200) {
          console.log(source_default.green(`"${v.slice(0, 200)}..."`));
        } else {
          console.log(source_default.green(`"${v}"`));
        }
      } else {
        console.log(source_default.yellow(String(v)));
      }
    }
    console.log(pad2 + "}");
  }
}
function parseToolCall(line) {
  const parts = line.match(/(?:[^\s"]+|"[^"]*")+/g);
  if (!parts || parts.length === 0)
    return null;
  const tool = parts[0];
  const args = {};
  for (let i = 1;i < parts.length; i++) {
    const eqIdx = parts[i].indexOf("=");
    if (eqIdx === -1)
      continue;
    const key = parts[i].slice(0, eqIdx);
    let val = parts[i].slice(eqIdx + 1);
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    }
    if (val === "true")
      args[key] = true;
    else if (val === "false")
      args[key] = false;
    else if (/^\d+$/.test(val))
      args[key] = parseInt(val, 10);
    else if (/^\d+\.\d+$/.test(val))
      args[key] = parseFloat(val);
    else
      args[key] = val;
  }
  return { tool, args };
}
function printHelp(tools) {
  console.log(source_default.bold(`
Available commands:
`));
  console.log(source_default.cyan("  help") + source_default.dim("                      \u2014 show this help"));
  console.log(source_default.cyan("  tools") + source_default.dim("                     \u2014 list all available tools"));
  console.log(source_default.cyan("  describe <tool>") + source_default.dim("           \u2014 show tool schema"));
  console.log(source_default.cyan("  <tool> [key=value ...]") + source_default.dim("   \u2014 call a tool"));
  console.log(source_default.cyan("  exit / quit / Ctrl+C") + source_default.dim("     \u2014 exit playground"));
  console.log();
  if (tools.length > 0) {
    console.log(source_default.bold("Available tools:"));
    for (const t of tools) {
      console.log(source_default.cyan(`  ${t.name}`) + (t.description ? source_default.dim(` \u2014 ${t.description}`) : ""));
    }
    console.log();
  }
}
function printTools(tools) {
  if (tools.length === 0) {
    console.log(source_default.yellow("  No tools available from this MCP server."));
    return;
  }
  console.log(source_default.bold(`
${tools.length} tools available:
`));
  for (const t of tools) {
    console.log(source_default.cyan(`  ${t.name}`));
    if (t.description) {
      console.log(source_default.dim(`    ${t.description}`));
    }
  }
  console.log();
}
function describeTool(tools, name) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    console.log(source_default.red(`  Unknown tool: ${name}`));
    const matches = tools.filter((t) => t.name.includes(name));
    if (matches.length > 0) {
      console.log(source_default.dim(`  Did you mean: ${matches.map((m) => m.name).join(", ")}?`));
    }
    return;
  }
  console.log(source_default.bold(`
${tool.name}`));
  if (tool.description) {
    console.log(source_default.dim(`  ${tool.description}`));
  }
  if (tool.inputSchema?.properties) {
    console.log(source_default.bold(`
  Parameters:`));
    const required = new Set(tool.inputSchema.required || []);
    for (const [key, schema] of Object.entries(tool.inputSchema.properties)) {
      const req = required.has(key) ? source_default.red("*") : " ";
      console.log(`  ${req} ${source_default.cyan(key)}` + source_default.dim(` (${schema.type})`) + (schema.description ? source_default.dim(` \u2014 ${schema.description}`) : ""));
    }
  }
  console.log();
}
function registerPlaygroundCommand(program2) {
  program2.command("playground <service>").description("Interactive MCP tool testing REPL").action(async (service) => {
    const pkg = REGISTRY.find((r) => r.name === service);
    if (!pkg) {
      console.error(source_default.red(`Unknown service: ${service}`));
      console.error(source_default.dim(`Available: ${REGISTRY.map((r) => r.name).join(", ")}`));
      process.exit(1);
    }
    if (!pkg.bins.mcp) {
      console.error(source_default.red(`No MCP server for ${service}`));
      process.exit(1);
    }
    if (!binaryExists(pkg.bins.mcp)) {
      console.error(source_default.red(`MCP binary not found on PATH: ${pkg.bins.mcp}`));
      console.error(source_default.dim(`Install with: bun install -g ${pkg.npm}`));
      process.exit(1);
    }
    console.log(source_default.bold("agency playground") + source_default.dim(` \u2014 ${service}
`));
    console.log(source_default.dim(`Spawning MCP server: ${pkg.bins.mcp}`));
    const proc = Bun.spawn([pkg.bins.mcp], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe"
    });
    let requestId = 0;
    let tools = [];
    const stderrReader = proc.stderr.getReader();
    (async () => {
      try {
        while (true) {
          const { done } = await stderrReader.read();
          if (done)
            break;
        }
      } catch {}
    })();
    function cleanup() {
      try {
        proc.kill();
      } catch {}
    }
    process.on("SIGINT", () => {
      cleanup();
      process.exit(0);
    });
    try {
      requestId++;
      sendJsonRpc(proc, {
        jsonrpc: "2.0",
        id: requestId,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "agency-playground", version: "0.1.0" }
        }
      });
      const initResp = await readJsonRpcMessage(proc);
      if (initResp.error) {
        console.error(source_default.red(`MCP initialize error: ${JSON.stringify(initResp.error)}`));
        cleanup();
        process.exit(1);
      }
      const notif = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + `
`;
      proc.stdin.write(notif);
      console.log(source_default.green("  Connected!"));
      const serverInfo = initResp.result?.serverInfo;
      if (serverInfo) {
        console.log(source_default.dim(`  Server: ${serverInfo.name || service} v${serverInfo.version || "?"}`));
      }
    } catch (err) {
      console.error(source_default.red(`Failed to initialize MCP server: ${err.message}`));
      cleanup();
      process.exit(1);
    }
    try {
      requestId++;
      sendJsonRpc(proc, {
        jsonrpc: "2.0",
        id: requestId,
        method: "tools/list",
        params: {}
      });
      const listResp = await readJsonRpcMessage(proc);
      if (listResp.result?.tools) {
        tools = listResp.result.tools;
        console.log(source_default.dim(`  ${tools.length} tools available`));
      }
    } catch (err) {
      console.log(source_default.yellow(`  Warning: could not list tools: ${err.message}`));
    }
    console.log(source_default.dim(`
Type "help" for commands, "tools" to list tools, or call a tool directly.
`));
    const toolNames = tools.map((t) => t.name);
    const commands = ["help", "tools", "describe", "exit", "quit"];
    const allCompletions = [...commands, ...toolNames];
    const rl = createInterface2({
      input: process.stdin,
      output: process.stdout,
      prompt: source_default.bold(`${service}> `),
      completer: (line) => {
        const hits = allCompletions.filter((c) => c.startsWith(line));
        return [hits.length > 0 ? hits : allCompletions, line];
      }
    });
    rl.prompt();
    rl.on("line", async (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        rl.prompt();
        return;
      }
      if (trimmed === "exit" || trimmed === "quit") {
        cleanup();
        process.exit(0);
      }
      if (trimmed === "help") {
        printHelp(tools);
        rl.prompt();
        return;
      }
      if (trimmed === "tools") {
        printTools(tools);
        rl.prompt();
        return;
      }
      if (trimmed.startsWith("describe ")) {
        const toolName = trimmed.slice("describe ".length).trim();
        describeTool(tools, toolName);
        rl.prompt();
        return;
      }
      const parsed = parseToolCall(trimmed);
      if (!parsed) {
        console.log(source_default.red("  Could not parse input. Format: tool_name key=value ..."));
        rl.prompt();
        return;
      }
      const matchedTool = tools.find((t) => t.name === parsed.tool);
      if (!matchedTool) {
        console.log(source_default.red(`  Unknown tool: ${parsed.tool}`));
        const matches = tools.filter((t) => t.name.includes(parsed.tool));
        if (matches.length > 0) {
          console.log(source_default.dim(`  Did you mean: ${matches.map((m) => m.name).join(", ")}?`));
        }
        rl.prompt();
        return;
      }
      try {
        requestId++;
        sendJsonRpc(proc, {
          jsonrpc: "2.0",
          id: requestId,
          method: "tools/call",
          params: {
            name: parsed.tool,
            arguments: parsed.args
          }
        });
        const resp = await readJsonRpcMessage(proc, 30000);
        if (resp.error) {
          console.log(source_default.red(`
  Error: ${JSON.stringify(resp.error)}`));
        } else if (resp.result) {
          console.log();
          const content = resp.result.content || resp.result;
          if (Array.isArray(content)) {
            for (const item of content) {
              if (item.type === "text") {
                try {
                  const parsed2 = JSON.parse(item.text ?? "");
                  prettyPrint(parsed2);
                } catch {
                  console.log(item.text);
                }
              } else {
                prettyPrint(item);
              }
            }
          } else {
            prettyPrint(content);
          }
        }
        console.log();
      } catch (err) {
        console.log(source_default.red(`
  Request failed: ${err.message}
`));
      }
      rl.prompt();
    });
    rl.on("close", () => {
      cleanup();
      process.exit(0);
    });
  });
}

// src/commands/logs.ts
import { existsSync as existsSync5, readdirSync as readdirSync4, statSync as statSync5, watch, createReadStream, openSync as openSync2, readSync, closeSync as closeSync2 } from "fs";
import { join as join6 } from "path";
var ACTIVITY_LOG = join6(HASNA_HOME, "cloud", "activity.log");
var SERVICE_COLORS = [
  source_default.cyan,
  source_default.magenta,
  source_default.yellow,
  source_default.green,
  source_default.blue,
  source_default.red,
  source_default.white,
  source_default.gray,
  source_default.cyanBright,
  source_default.magentaBright,
  source_default.yellowBright,
  source_default.greenBright,
  source_default.blueBright,
  source_default.redBright
];
function getServiceColor(service, colorMap) {
  if (!colorMap.has(service)) {
    const idx = colorMap.size % SERVICE_COLORS.length;
    colorMap.set(service, SERVICE_COLORS[idx]);
  }
  return colorMap.get(service);
}
function findLogFiles(services) {
  const results = [];
  if (existsSync5(ACTIVITY_LOG)) {
    results.push({ service: "cloud", path: ACTIVITY_LOG });
  }
  const targets = services && services.length > 0 ? REGISTRY.filter((p) => services.includes(p.name)) : REGISTRY;
  for (const pkg of targets) {
    const dp = dataPath(pkg.dataDir);
    if (!dirExists(dp))
      continue;
    try {
      const entries = readdirSync4(dp, { recursive: true });
      for (const entry of entries) {
        if (!String(entry).endsWith(".log"))
          continue;
        const full = join6(dp, String(entry));
        try {
          if (statSync5(full).isFile()) {
            results.push({ service: pkg.name, path: full });
          }
        } catch {}
      }
    } catch {}
  }
  return results;
}
function parseDuration(dur) {
  const match = dur.match(/^(\d+)(s|m|h|d)$/);
  if (!match)
    return null;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "d":
      return value * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}
function isErrorLine(line) {
  const lower = line.toLowerCase();
  return lower.includes("error") || lower.includes("fail") || lower.includes("fatal") || lower.includes("panic");
}
function extractTimestamp(line) {
  const isoMatch = line.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/);
  if (isoMatch) {
    const d = new Date(isoMatch[1]);
    if (!isNaN(d.getTime()))
      return d;
  }
  const bracketMatch = line.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/);
  if (bracketMatch) {
    const d = new Date(bracketMatch[1]);
    if (!isNaN(d.getTime()))
      return d;
  }
  return null;
}
function readLastLines(filePath, maxLines) {
  try {
    const { size } = statSync5(filePath);
    const TAIL_BYTES = 256 * 1024;
    const fd = openSync2(filePath, "r");
    try {
      const start = Math.max(0, size - TAIL_BYTES);
      const buf = Buffer.alloc(size - start);
      readSync(fd, buf, 0, buf.length, start);
      const content = buf.toString("utf8");
      const lines = content.split(`
`).filter(Boolean);
      return lines.slice(-maxLines);
    } finally {
      closeSync2(fd);
    }
  } catch {
    return [];
  }
}
function formatLine(service, line, colorFn) {
  const trimmed = line.trim();
  if (!trimmed)
    return "";
  return `${source_default.dim("[")}${colorFn(service.padEnd(14))}${source_default.dim("]")} ${trimmed}`;
}
function registerLogsCommand(program2) {
  program2.command("logs [services...]").description("Unified log stream across services").option("--errors", "Only show error lines").option("--since <duration>", "Filter logs from duration ago (e.g. 1h, 30m, 2d)").option("--tail <lines>", "Number of recent lines to show initially", "50").option("--no-follow", "Print logs and exit without following").action((services, opts) => {
    const logFiles = findLogFiles(services.length > 0 ? services : undefined);
    if (logFiles.length === 0) {
      console.log(source_default.yellow("No log files found."));
      console.log(source_default.dim(`  Checked: ${ACTIVITY_LOG}`));
      console.log(source_default.dim(`  And per-service directories under ${HASNA_HOME}/`));
      return;
    }
    const colorMap = new Map;
    const tailCount = parseInt(opts.tail, 10) || 50;
    let cutoff = null;
    if (opts.since) {
      const ms = parseDuration(opts.since);
      if (ms === null) {
        console.error(source_default.red(`Invalid duration: ${opts.since}. Use format like 1h, 30m, 2d`));
        process.exit(1);
      }
      cutoff = new Date(Date.now() - ms);
    }
    console.log(source_default.bold("agency logs") + source_default.dim(` \u2014 streaming ${logFiles.length} log file(s)
`));
    for (const lf of logFiles) {
      console.log(source_default.dim(`  ${lf.service}: ${lf.path}`));
    }
    console.log();
    for (const lf of logFiles) {
      const colorFn = getServiceColor(lf.service, colorMap);
      const lines = readLastLines(lf.path, tailCount);
      for (const line of lines) {
        if (opts.errors && !isErrorLine(line))
          continue;
        if (cutoff) {
          const ts = extractTimestamp(line);
          if (ts && ts < cutoff)
            continue;
        }
        const formatted = formatLine(lf.service, line, colorFn);
        if (formatted)
          console.log(formatted);
      }
    }
    if (!opts.follow)
      return;
    console.log(source_default.dim(`
--- watching for new lines (Ctrl+C to stop) ---
`));
    const watchers = [];
    const filePositions = new Map;
    for (const lf of logFiles) {
      try {
        const size = statSync5(lf.path).size;
        filePositions.set(lf.path, size);
      } catch {
        filePositions.set(lf.path, 0);
      }
    }
    for (const lf of logFiles) {
      const colorFn = getServiceColor(lf.service, colorMap);
      try {
        const watcher = watch(lf.path, () => {
          try {
            const currentSize = statSync5(lf.path).size;
            const prevSize = filePositions.get(lf.path) || 0;
            if (currentSize <= prevSize) {
              filePositions.set(lf.path, currentSize);
              return;
            }
            const stream = createReadStream(lf.path, {
              start: prevSize,
              end: currentSize - 1,
              encoding: "utf8"
            });
            let buffer = "";
            stream.on("data", (chunk) => {
              buffer += chunk;
            });
            stream.on("end", () => {
              const newLines = buffer.split(`
`).filter(Boolean);
              for (const line of newLines) {
                if (opts.errors && !isErrorLine(line))
                  continue;
                if (cutoff) {
                  const ts = extractTimestamp(line);
                  if (ts && ts < cutoff)
                    continue;
                }
                const formatted = formatLine(lf.service, line, colorFn);
                if (formatted)
                  console.log(formatted);
              }
            });
            filePositions.set(lf.path, currentSize);
          } catch {}
        });
        watchers.push(watcher);
      } catch {}
    }
    process.on("SIGINT", () => {
      for (const w of watchers) {
        w.close();
      }
      console.log(source_default.dim(`
Stopped.`));
      process.exit(0);
    });
  });
}

// src/commands/search.ts
import { existsSync as existsSync6, readdirSync as readdirSync5, statSync as statSync6 } from "fs";
import { join as join7 } from "path";
function isSafeIdentifier2(value) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}
var MAX_SEARCH_LIMIT = 100;
var SERVICE_TABLES = {
  todos: [{ table: "tasks", columns: ["title", "description"] }],
  mementos: [
    { table: "memories", columns: ["content", "context"] },
    { table: "entities", columns: ["name", "description"] }
  ],
  emails: [{ table: "emails", columns: ["subject", "body", "to_address", "from_address"] }],
  prompts: [{ table: "prompts", columns: ["content", "name", "description"] }],
  contacts: [
    { table: "contacts", columns: ["name", "email", "notes"] },
    { table: "companies", columns: ["name", "description"] }
  ],
  conversations: [{ table: "messages", columns: ["content"] }],
  recordings: [{ table: "recordings", columns: ["title", "transcript", "enhanced"] }],
  implementations: [{ table: "implementations", columns: ["title", "description", "notes"] }],
  sessions: [{ table: "sessions", columns: ["summary", "notes", "tags"] }],
  testers: [{ table: "scenarios", columns: ["title", "description", "steps"] }],
  tickets: [{ table: "tickets", columns: ["title", "description"] }],
  skills: [{ table: "skills", columns: ["name", "description"] }],
  hooks: [{ table: "hooks", columns: ["name", "description"] }],
  configs: [{ table: "configs", columns: ["name", "content"] }],
  secrets: [{ table: "secrets", columns: ["key", "description"] }],
  brains: [{ table: "models", columns: ["name", "description"] }],
  files: [{ table: "files", columns: ["path", "name", "tags"] }],
  search: [{ table: "searches", columns: ["query", "results"] }],
  wallets: [{ table: "cards", columns: ["label", "notes"] }]
};
function findDbFiles2(serviceDir) {
  if (!dirExists(serviceDir))
    return [];
  const files = [];
  try {
    const entries = readdirSync5(serviceDir, { recursive: true });
    for (const entry of entries) {
      const full = join7(serviceDir, String(entry));
      if ((full.endsWith(".db") || full.endsWith(".sqlite") || full.endsWith(".sqlite3")) && existsSync6(full)) {
        try {
          if (statSync6(full).isFile()) {
            files.push(full);
          }
        } catch {}
      }
    }
  } catch {}
  return files;
}
function tableExists(dbPath, tableName) {
  if (!isSafeIdentifier2(tableName))
    return false;
  const result = spawnSafe("sqlite3", [dbPath, `SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}';`]);
  return result !== null && result.trim() === tableName;
}
function getExistingColumns(dbPath, tableName, wantedColumns) {
  if (!isSafeIdentifier2(tableName))
    return [];
  const result = spawnSafe("sqlite3", [dbPath, `PRAGMA table_info(${tableName});`]);
  if (!result)
    return [];
  const existingCols = result.split(`
`).filter(Boolean).map((line) => {
    const parts = line.split("|");
    return parts[1] || "";
  }).filter(Boolean);
  return wantedColumns.filter((c) => existingCols.includes(c));
}
function searchTable(dbPath, serviceName, tableName, columns, query, limit) {
  if (!tableExists(dbPath, tableName))
    return [];
  const existingCols = getExistingColumns(dbPath, tableName, columns);
  if (existingCols.length === 0)
    return [];
  const results = [];
  const escapedQuery = query.replace(/'/g, "''");
  for (const col of existingCols) {
    if (!isSafeIdentifier2(col) || !isSafeIdentifier2(tableName))
      continue;
    const sql = `SELECT rowid, substr(${col}, 1, 200) FROM "${tableName}" WHERE "${col}" LIKE '%${escapedQuery}%' LIMIT ${limit};`;
    const raw = spawnSafe("sqlite3", [dbPath, sql]);
    if (!raw)
      continue;
    for (const line of raw.split(`
`).filter(Boolean)) {
      const sepIdx = line.indexOf("|");
      if (sepIdx === -1)
        continue;
      const rowId = line.slice(0, sepIdx);
      const snippet = line.slice(sepIdx + 1).trim();
      results.push({ service: serviceName, table: tableName, column: col, snippet, rowId });
    }
  }
  return results;
}
function highlight(text, query) {
  const lower = text.toLowerCase();
  const queryLower = query.toLowerCase();
  let result = "";
  let lastIndex = 0;
  let idx = lower.indexOf(queryLower, lastIndex);
  while (idx !== -1) {
    result += text.slice(lastIndex, idx);
    result += source_default.bold.yellow(text.slice(idx, idx + query.length));
    lastIndex = idx + query.length;
    idx = lower.indexOf(queryLower, lastIndex);
  }
  result += text.slice(lastIndex);
  return result;
}
var SERVICE_COLORS2 = {};
var PALETTE = [
  source_default.cyan,
  source_default.magenta,
  source_default.yellow,
  source_default.green,
  source_default.blue,
  source_default.redBright,
  source_default.cyanBright,
  source_default.magentaBright
];
function serviceColor(name) {
  if (!SERVICE_COLORS2[name]) {
    const idx = Object.keys(SERVICE_COLORS2).length % PALETTE.length;
    SERVICE_COLORS2[name] = PALETTE[idx];
  }
  return SERVICE_COLORS2[name];
}
function registerSearchCommand(program2) {
  program2.command("search <query>").description("Cross-service search across all SQLite databases").option("-l, --limit <n>", "Max results per service", "5").option("-s, --service <name>", "Search only a specific service").option("--json", "Output as JSON").action((query, opts) => {
    const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 5, 1), MAX_SEARCH_LIMIT);
    let packages = dbPackages();
    if (opts.service) {
      packages = packages.filter((p) => p.name === opts.service);
      if (packages.length === 0) {
        console.error(source_default.red(`Service not found: ${opts.service}`));
        process.exit(1);
      }
    }
    if (!opts.json) {
      console.log(source_default.bold("agency search") + source_default.dim(` \u2014 "${query}"
`));
    }
    const allResults = {};
    let totalMatches = 0;
    for (const pkg of packages) {
      const dp = dataPath(pkg.dataDir);
      const dbFiles = findDbFiles2(dp);
      if (dbFiles.length === 0)
        continue;
      const knownTables = SERVICE_TABLES[pkg.name];
      const serviceResults = [];
      for (const dbFile of dbFiles) {
        if (knownTables) {
          for (const { table, columns } of knownTables) {
            const results = searchTable(dbFile, pkg.name, table, columns, query, limit);
            serviceResults.push(...results);
          }
        } else {
          const tablesRaw = spawnSafe("sqlite3", [dbFile, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%';"]);
          if (!tablesRaw)
            continue;
          const tables = tablesRaw.split(`
`).filter(Boolean).filter(isSafeIdentifier2);
          for (const table of tables) {
            const colsRaw = spawnSafe("sqlite3", [dbFile, `PRAGMA table_info(${table});`]);
            if (!colsRaw)
              continue;
            const textCols = colsRaw.split(`
`).filter(Boolean).map((line) => {
              const parts = line.split("|");
              return { name: parts[1] || "", type: (parts[2] || "").toUpperCase() };
            }).filter((c) => c.type === "TEXT" || c.type === "VARCHAR" || c.type === "").map((c) => c.name);
            if (textCols.length > 0) {
              const results = searchTable(dbFile, pkg.name, table, textCols, query, limit);
              serviceResults.push(...results);
            }
          }
        }
      }
      if (serviceResults.length > 0) {
        const limited = serviceResults.slice(0, limit);
        allResults[pkg.name] = limited;
        totalMatches += limited.length;
      }
    }
    if (opts.json) {
      console.log(JSON.stringify(allResults, null, 2));
      return;
    }
    if (totalMatches === 0) {
      console.log(source_default.dim("  No results found across any service."));
      return;
    }
    for (const [service, results] of Object.entries(allResults)) {
      const colorFn = serviceColor(service);
      console.log(colorFn(`  ${service}`) + source_default.dim(`: ${results.length} match(es)`));
      for (const r of results) {
        const snippet = r.snippet.length > 120 ? r.snippet.slice(0, 120) + "..." : r.snippet;
        const highlighted = highlight(snippet, query);
        console.log(`    ${source_default.dim(`[${r.table}.${r.column}]`)} ${highlighted}`);
      }
      console.log();
    }
    console.log(source_default.dim(`  ${totalMatches} total match(es) across ${Object.keys(allResults).length} service(s)`));
  });
}

// src/commands/export.ts
import { existsSync as existsSync7, mkdirSync as mkdirSync5, readdirSync as readdirSync6, statSync as statSync7, writeFileSync as writeFileSync4 } from "fs";
import { join as join8, resolve as resolve3, basename } from "path";
import { homedir as homedir3 } from "os";
function isSafeIdentifier3(value) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}
function generateExportName(format) {
  const now = new Date;
  const ts = now.toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const ext = format === "json" ? "json.tar.gz" : "tar.gz";
  return `hasna-export-${ts}.${ext}`;
}
function findDbFiles3(dir) {
  if (!dirExists(dir))
    return [];
  const files = [];
  try {
    const entries = readdirSync6(dir, { recursive: true });
    for (const entry of entries) {
      const full = join8(dir, String(entry));
      if (full.endsWith(".db") || full.endsWith(".sqlite") || full.endsWith(".sqlite3")) {
        try {
          if (statSync7(full).isFile()) {
            files.push(full);
          }
        } catch {}
      }
    }
  } catch {}
  return files;
}
function dumpDbToJson(dbPath, outputDir) {
  const tablesRaw = spawnSafe("sqlite3", [dbPath, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"]);
  if (tablesRaw === null) {
    return { exported: 0, omitted: [dbPath] };
  }
  const discovered = tablesRaw.split(`
`).filter(Boolean);
  const omittedPre = discovered.filter((t) => !isSafeIdentifier3(t));
  const tables = discovered.filter(isSafeIdentifier3);
  let tableCount = 0;
  const omitted = [...omittedPre];
  for (const table of tables) {
    const jsonData = spawnSafe("sqlite3", [dbPath, "-json", `SELECT * FROM "${table}";`], 30000);
    if (jsonData === null) {
      omitted.push(table);
      continue;
    }
    if (jsonData.trim() === "") {
      const outFile = join8(outputDir, `${table}.json`);
      writeFileSync4(outFile, `[]
`);
      tableCount++;
      continue;
    }
    try {
      const parsed = JSON.parse(jsonData);
      const outFile = join8(outputDir, `${table}.json`);
      writeFileSync4(outFile, JSON.stringify(parsed, null, 2));
      tableCount++;
    } catch {
      const csvData = spawnSafe("sqlite3", [dbPath, "-header", "-csv", `SELECT * FROM "${table}";`], 30000);
      if (csvData) {
        const outFile = join8(outputDir, `${table}.csv`);
        writeFileSync4(outFile, csvData);
        tableCount++;
      } else {
        omitted.push(table);
      }
    }
  }
  return { exported: tableCount, omitted };
}
var EXCLUDE_PATTERNS = ["node_modules", ".next", ".cache", "backups", "__pycache__", ".git", "*.tmp"];
function registerExportCommand(program2) {
  const exportCmd = program2.command("export").description("Export ~/.hasna data as tarball or JSON").option("--format <format>", "Export format: tarball (default) or json", "tarball").option("--service <name>", "Export only a specific service").option("-o, --output <path>", "Output file path").action((opts) => {
    if (!dirExists(HASNA_HOME)) {
      console.error(source_default.red("~/.hasna does not exist. Run 'agency init' first."));
      process.exit(1);
    }
    const format = opts.format === "json" ? "json" : "tarball";
    if (format === "json") {
      exportAsJson(opts.service, opts.output);
    } else {
      exportAsTarball(opts.service, opts.output);
    }
  });
  program2.command("import <file>").description("Restore from a previously exported archive").option("--dry-run", "Show what would be restored without restoring").option("--force", "Overwrite existing data without prompting").action((file, opts) => {
    const filePath = resolve3(file);
    if (!existsSync7(filePath)) {
      console.error(source_default.red(`File not found: ${filePath}`));
      process.exit(1);
    }
    console.log(source_default.bold(`agency import
`));
    console.log(source_default.dim(`  Source: ${filePath}`));
    console.log(source_default.dim(`  Target: ${HASNA_HOME}
`));
    const listing = listTarball(filePath, 40);
    if (listing === null) {
      console.error(source_default.red(`  Invalid or unreadable archive: ${filePath}`));
      console.error(source_default.red("  Refusing to import from an unverified archive."));
      process.exit(1);
    }
    console.log(source_default.dim("  Contents (first 40 entries):"));
    for (const line of listing.split(`
`).filter(Boolean)) {
      console.log(source_default.dim(`    ${line}`));
    }
    console.log();
    try {
      const size = statSync7(filePath).size;
      console.log(source_default.dim(`  Archive size: ${formatBytes(size)}`));
    } catch {}
    if (opts.dryRun) {
      console.log(source_default.yellow(`
  Dry run \u2014 no changes made.`));
      return;
    }
    if (!opts.force) {
      console.log(source_default.yellow(`
  Warning: this will overwrite existing data in ~/.hasna/`));
      console.log(source_default.dim("  Use --force to skip this warning."));
      console.log(source_default.dim(`  Use --dry-run to preview without changes.
`));
      console.error(source_default.red("  Aborting. Use --force to proceed."));
      process.exit(1);
    }
    const staging = execSafe(`mktemp -d /tmp/hasna-import.XXXXXX`, 5000);
    if (staging === null) {
      console.error(source_default.red("  Import failed: could not create staging directory."));
      process.exit(1);
    }
    try {
      const extractResult = spawnSafe("tar", ["-xzf", filePath, "-C", staging], 120000);
      if (extractResult === null) {
        console.error(source_default.red("  Import failed: archive extraction into staging failed."));
        console.error(source_default.red(`  Live data untouched. Staging: ${staging}`));
        process.exit(1);
      }
      const outcome = copyStagedWithRollback(staging, HASNA_HOME);
      if (outcome.warning) {
        console.error(source_default.yellow(`  ${outcome.warning}`));
      }
      if (outcome.ok) {
        console.log(source_default.green(`
  Import complete.`));
      } else if (outcome.copyApplied) {
        console.error(source_default.red("  Import applied, but the pre-copy snapshot could not be removed."));
        console.error(source_default.red(`  Sensitive pre-copy snapshot retained at: ${outcome.snapshot}`));
        console.error(source_default.red("  Remove it manually once the imported data is verified."));
        process.exit(1);
      } else if (outcome.rolledBack) {
        console.error(source_default.red("  Import failed: copying staged content into ~/.hasna failed."));
        console.error(source_default.red("  Live data was rolled back to the pre-copy state."));
        if (outcome.snapshot) {
          console.error(source_default.red(`  Pre-copy snapshot retained at: ${outcome.snapshot}`));
        }
        if (outcome.retainedSwap) {
          console.error(source_default.red(`  Displaced live tree retained at: ${outcome.retainedSwap}`));
        }
        process.exit(1);
      } else {
        console.error(source_default.red("  Import failed: copying staged content into ~/.hasna failed."));
        if (outcome.snapshot) {
          console.error(source_default.red(`  Rollback could not complete. Pre-copy snapshot preserved at: ${outcome.snapshot}`));
        } else {
          console.error(source_default.red("  No pre-copy snapshot could be taken; live data may be partially imported."));
        }
        if (outcome.retainedSwap) {
          console.error(source_default.red(`  Displaced live tree retained at: ${outcome.retainedSwap}`));
        }
        console.error(source_default.red(`  Staged copy preserved at: ${staging}`));
        process.exit(1);
      }
    } finally {
      const cleanup = execSafe(`rm -rf "${staging}" 2>&1`, 5000);
      if (cleanup === null) {
        console.error(source_default.yellow(`  Warning: could not remove staging dir: ${staging}`));
      }
    }
  });
}
function exportAsTarball(service, output) {
  console.log(source_default.bold("agency export") + source_default.dim(` \u2014 tarball
`));
  let sourceDir;
  let filename;
  if (service) {
    const pkg = findPackage(service);
    if (!pkg) {
      console.error(source_default.red(`Unknown service: ${service}`));
      process.exit(1);
    }
    sourceDir = dataPath(pkg.dataDir);
    if (!dirExists(sourceDir)) {
      console.error(source_default.red(`No data directory for ${service}: ${sourceDir}`));
      process.exit(1);
    }
    filename = `hasna-export-${service}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.tar.gz`;
  } else {
    sourceDir = HASNA_HOME;
    filename = generateExportName("tarball");
  }
  const outputPath = output ? resolve3(output) : join8(homedir3(), filename);
  const excludeArgs = EXCLUDE_PATTERNS;
  console.log(source_default.dim(`  Source: ${sourceDir}`));
  console.log(source_default.dim(`  Output: ${outputPath}
`));
  const result = service ? spawnSafe("tar", ["-czf", outputPath, "-h", ...excludeArgs.map((p) => `--exclude=${p}`), "-C", HASNA_HOME, service], 120000) : spawnSafe("tar", ["-czf", outputPath, "-h", ...excludeArgs.map((p) => `--exclude=${p}`), "-C", HASNA_HOME, "."], 120000);
  if (result !== null && existsSync7(outputPath)) {
    const size = statSync7(outputPath).size;
    console.log(source_default.green(`  Export created: ${outputPath}`));
    console.log(source_default.dim(`  Size: ${formatBytes(size)}`));
  } else {
    console.error(source_default.red(`  Export failed: ${result || "unknown error"}`));
    process.exit(1);
  }
}
function exportAsJson(service, output) {
  console.log(source_default.bold("agency export") + source_default.dim(` \u2014 JSON
`));
  const tmpBase = join8(HASNA_HOME, ".export-tmp");
  if (existsSync7(tmpBase)) {
    execSafe(`rm -rf "${tmpBase}"`, 1e4);
  }
  mkdirSync5(tmpBase, { recursive: true });
  let packages = dbPackages();
  if (service) {
    packages = packages.filter((p) => p.name === service);
    if (packages.length === 0) {
      console.error(source_default.red(`Unknown or non-database service: ${service}`));
      execSafe(`rm -rf "${tmpBase}"`, 1e4);
      process.exit(1);
    }
  }
  let totalTables = 0;
  for (const pkg of packages) {
    const dp = dataPath(pkg.dataDir);
    const dbFiles = findDbFiles3(dp);
    if (dbFiles.length === 0)
      continue;
    const svcDir = join8(tmpBase, pkg.name);
    mkdirSync5(svcDir, { recursive: true });
    for (const dbFile of dbFiles) {
      const dbName = basename(dbFile, ".db").replace(".sqlite3", "").replace(".sqlite", "");
      const tableDir = join8(svcDir, dbName);
      mkdirSync5(tableDir, { recursive: true });
      const { exported, omitted } = dumpDbToJson(dbFile, tableDir);
      totalTables += exported;
      if (omitted.length > 0) {
        console.error(source_default.red(`  ${pkg.name}/${dbName}: ${omitted.length} table(s) FAILED to export: ${omitted.slice(0, 10).join(", ")}`));
        execSafe(`rm -rf "${tmpBase}"`, 1e4);
        process.exit(1);
      }
      if (exported > 0) {
        console.log(source_default.dim(`  ${pkg.name}/${dbName}: ${exported} table(s) exported`));
      }
    }
  }
  if (totalTables === 0) {
    console.log(source_default.yellow("  No data found to export."));
    execSafe(`rm -rf "${tmpBase}"`, 1e4);
    return;
  }
  const filename = service ? `hasna-export-${service}-json-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.tar.gz` : generateExportName("json");
  const outputPath = output ? resolve3(output) : join8(homedir3(), filename);
  const result = spawnSafe("tar", ["-czf", outputPath, "-C", tmpBase, "."], 120000);
  execSafe(`rm -rf "${tmpBase}"`, 1e4);
  if (result !== null && existsSync7(outputPath)) {
    const size = statSync7(outputPath).size;
    console.log(source_default.green(`
  JSON export created: ${outputPath}`));
    console.log(source_default.dim(`  Size: ${formatBytes(size)}`));
    console.log(source_default.dim(`  Tables: ${totalTables}`));
  } else {
    console.error(source_default.red(`
  Export failed: ${result || "unknown error"}`));
    process.exit(1);
  }
}

// src/commands/new.ts
import { mkdirSync as mkdirSync6, writeFileSync as writeFileSync5, existsSync as existsSync8 } from "fs";
import { join as join9, resolve as resolve4 } from "path";
function packageJson(name, kind) {
  if (kind === "library") {
    return JSON.stringify({
      name: `@hasna/${name}`,
      version: "0.1.0",
      description: `TODO: describe ${name}`,
      type: "module",
      main: "dist/index.js",
      types: "dist/index.d.ts",
      exports: {
        ".": { types: "./dist/index.d.ts", import: "./dist/index.js" }
      },
      files: ["dist", "LICENSE", "README.md"],
      scripts: {
        build: "bun build src/index.ts --outdir dist --target bun && tsc --emitDeclarationOnly --outDir dist",
        typecheck: "tsc --noEmit",
        test: "bun test"
      },
      license: "Apache-2.0",
      publishConfig: { registry: "https://registry.npmjs.org", access: "public" },
      dependencies: {},
      devDependencies: { "@types/bun": "1.3.14", typescript: "^5" }
    }, null, 2);
  }
  return JSON.stringify({
    name: `@hasna/${name}`,
    version: "0.1.0",
    description: `TODO: describe ${name}`,
    type: "module",
    main: "dist/index.js",
    types: "dist/index.d.ts",
    bin: {
      [name]: "dist/cli/index.js",
      [`${name}-mcp`]: "dist/mcp/index.js",
      [`${name}-serve`]: "dist/server/index.js"
    },
    exports: {
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" }
    },
    files: ["dist", "LICENSE", "README.md"],
    scripts: {
      build: [
        `bun build src/cli/index.ts --outdir dist/cli --target bun`,
        `bun build src/mcp/index.ts --outdir dist/mcp --target bun --external @modelcontextprotocol/sdk`,
        `bun build src/server/index.ts --outdir dist/server --target bun`,
        `bun build src/index.ts --outdir dist --target bun`,
        `tsc --emitDeclarationOnly --outDir dist`
      ].join(" && "),
      typecheck: "tsc --noEmit",
      test: "bun test",
      "dev:cli": "bun run src/cli/index.ts",
      "dev:mcp": "bun run src/mcp/index.ts",
      "dev:serve": "bun run src/server/index.ts"
    },
    license: "Apache-2.0",
    publishConfig: { registry: "https://registry.npmjs.org", access: "public" },
    postinstall: `mkdir -p $HOME/.hasna/${name} 2>/dev/null || true`,
    dependencies: {
      "@hasna/cloud": "^0.1.7",
      "@modelcontextprotocol/sdk": "^1",
      commander: "^12",
      chalk: "^5",
      zod: "^3"
    },
    devDependencies: { "@types/bun": "1.3.14", typescript: "^5" }
  }, null, 2);
}
function tsconfig() {
  return JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "ES2022",
      moduleResolution: "bundler",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      outDir: "dist",
      rootDir: "src",
      declaration: true,
      declarationMap: true,
      sourceMap: true,
      resolveJsonModule: true,
      isolatedModules: true,
      types: ["bun-types"]
    },
    include: ["src/**/*.ts"],
    exclude: ["node_modules", "dist", "**/*.test.ts"]
  }, null, 2);
}
function databaseTs(name) {
  return `import { Database } from "bun:sqlite";
import { SqliteAdapter, ensureFeedbackTable, migrateDotfile } from "@hasna/cloud";
import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";

let _db: Database | null = null;
let _adapter: SqliteAdapter | null = null;

const MIGRATIONS: { id: number; sql: string }[] = [
  {
    id: 1,
    sql: \`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    \`,
  },
];

function getDbPath(): string {
  if (process.env["HASNA_${name.toUpperCase().replace(/-/g, "_")}_DB_PATH"]) {
    return process.env["HASNA_${name.toUpperCase().replace(/-/g, "_")}_DB_PATH"]!;
  }
  if (process.env["${name.toUpperCase().replace(/-/g, "_")}_DB_PATH"]) {
    return process.env["${name.toUpperCase().replace(/-/g, "_")}_DB_PATH"]!;
  }
  const home = homedir();
  return join(home, ".hasna", "${name}", "${name}.db");
}

function ensureDir(filePath: string): void {
  if (filePath === ":memory:") return;
  const dir = join(filePath, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function runMigrations(db: Database): void {
  db.run(\`CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )\`);

  for (const migration of MIGRATIONS) {
    const applied = db.query("SELECT id FROM _migrations WHERE id = ?").get(migration.id);
    if (!applied) {
      db.run("BEGIN");
      try {
        db.run(migration.sql);
        db.run("INSERT INTO _migrations (id) VALUES (?)", [migration.id]);
        db.run("COMMIT");
      } catch (e) {
        db.run("ROLLBACK");
        throw e;
      }
    }
  }
}

export function getDatabase(): Database {
  if (_db) return _db;
  const dbPath = getDbPath();
  ensureDir(dbPath);
  _db = new Database(dbPath, { create: true });
  _db.exec("PRAGMA journal_mode=WAL");
  _db.exec("PRAGMA foreign_keys=ON");
  _db.exec("PRAGMA busy_timeout=5000");
  runMigrations(_db);
  return _db;
}

export function getAdapter(): SqliteAdapter {
  if (_adapter) return _adapter;
  const dbPath = getDbPath();
  ensureDir(dbPath);
  _adapter = new SqliteAdapter(dbPath);
  return _adapter;
}

export function resetDatabase(): void {
  _db = null;
  _adapter = null;
}

export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
  _adapter = null;
}
`;
}
function pgMigrationsTs() {
  return `/**
 * PostgreSQL migrations for cloud sync.
 *
 * Equivalent to the SQLite schema in database.ts, translated for PostgreSQL.
 */

export const PG_MIGRATIONS: string[] = [
  // Migration 1: agents table
  \`CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  )\`,
];
`;
}
function mcpIndexTs(name) {
  return `#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { registerCloudTools } from "@hasna/cloud";
import { getDatabase } from "../db/database.js";

const server = new McpServer({
  name: "${name}",
  version: "0.1.0",
});

// ---------------------------------------------------------------------------
// Agent management tools
// ---------------------------------------------------------------------------

server.tool(
  "register_agent",
  "Register or update an AI agent",
  { agent_id: z.string().describe("Unique agent identifier") },
  async ({ agent_id }) => {
    const db = getDatabase();
    const id = crypto.randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    db.run(
      \`INSERT INTO agents (id, name, last_seen_at) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET last_seen_at = excluded.last_seen_at\`,
      [id, agent_id, now],
    );
    return { content: [{ type: "text", text: \`Agent \${agent_id} registered\` }] };
  },
);

server.tool(
  "heartbeat",
  "Mark agent as active",
  { agent_id: z.string().describe("Agent identifier") },
  async ({ agent_id }) => {
    const db = getDatabase();
    const now = new Date().toISOString();
    db.run("UPDATE agents SET last_seen_at = ? WHERE name = ?", [now, agent_id]);
    return { content: [{ type: "text", text: \`Heartbeat recorded for \${agent_id}\` }] };
  },
);

server.tool(
  "list_agents",
  "List all registered agents",
  {},
  async () => {
    const db = getDatabase();
    const agents = db.query("SELECT * FROM agents ORDER BY last_seen_at DESC").all();
    return { content: [{ type: "text", text: JSON.stringify(agents, null, 2) }] };
  },
);

server.tool(
  "send_feedback",
  "Send feedback about the service",
  {
    agent_id: z.string().describe("Agent sending feedback"),
    message: z.string().describe("Feedback message"),
    rating: z.number().min(1).max(5).optional().describe("Rating 1-5"),
  },
  async ({ agent_id, message, rating }) => {
    return {
      content: [
        {
          type: "text",
          text: \`Feedback from \${agent_id}: \${message}\${rating ? \` (rating: \${rating})\` : ""}\`,
        },
      ],
    };
  },
);

// Register cloud sync tools
registerCloudTools(server, "${name}");

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
`;
}
function cliIndexTs(name) {
  return `#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import { getDatabase, closeDatabase } from "../db/database.js";
import { registerCloudCommands } from "@hasna/cloud";

const program = new Command();

program
  .name("${name}")
  .description("${name} \u2014 CLI")
  .version("0.1.0");

program
  .command("status")
  .description("Show service status")
  .action(() => {
    const db = getDatabase();
    const agents = db.query("SELECT COUNT(*) as count FROM agents").get() as { count: number };
    console.log(chalk.bold("${name} status\\n"));
    console.log(\`  Agents: \${agents.count}\`);
    closeDatabase();
  });

program
  .command("feedback <message>")
  .description("Send feedback")
  .option("--rating <n>", "Rating 1-5", parseInt)
  .action((message: string, opts: { rating?: number }) => {
    console.log(chalk.green("Feedback recorded:"), message);
    if (opts.rating) console.log(chalk.dim(\`  Rating: \${opts.rating}/5\`));
  });

// Register cloud sync/push/pull commands
registerCloudCommands(program, "${name}");

program.parse();
`;
}
function serverIndexTs(name) {
  return `#!/usr/bin/env bun
/**
 * HTTP server for ${name}.
 * Usage: ${name}-serve [--port 3000]
 */

import { getDatabase } from "../db/database.js";

const DEFAULT_PORT = 3000;

function parsePort(): number {
  const portArg = process.argv.find((a) => a === "--port" || a.startsWith("--port="));
  if (portArg) {
    if (portArg.includes("=")) {
      return parseInt(portArg.split("=")[1]!, 10) || DEFAULT_PORT;
    }
    const idx = process.argv.indexOf(portArg);
    return parseInt(process.argv[idx + 1]!, 10) || DEFAULT_PORT;
  }
  return DEFAULT_PORT;
}

const port = parsePort();

const server = Bun.serve({
  port,
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({ status: "ok", service: "${name}", timestamp: new Date().toISOString() });
    }

    if (url.pathname === "/api/agents") {
      const db = getDatabase();
      const agents = db.query("SELECT * FROM agents ORDER BY last_seen_at DESC").all();
      return Response.json(agents);
    }

    return Response.json({ error: "not found" }, { status: 404 });
  },
});

console.log(\`${name}-serve listening on http://localhost:\${server.port}\`);
`;
}
function libIndexTs(name) {
  return `// ---------------------------------------------------------------------------
// @hasna/${name} \u2014 Library exports
// ---------------------------------------------------------------------------

export { getDatabase, closeDatabase, resetDatabase } from "./db/database.js";
`;
}
function readmeTemplate(name, kind) {
  if (kind === "library") {
    return `# @hasna/${name}

TODO: describe ${name}.

## Install

\`\`\`bash
bun install @hasna/${name}
\`\`\`

## License

Apache-2.0
`;
  }
  return `# @hasna/${name}

TODO: describe ${name}.

## Install

\`\`\`bash
bun install -g @hasna/${name}
\`\`\`

## Usage

### CLI

\`\`\`bash
${name} status
${name} feedback "Great service!"
\`\`\`

### MCP Server

\`\`\`bash
${name}-mcp
\`\`\`

### HTTP Server

\`\`\`bash
${name}-serve --port 3000
\`\`\`

## License

Apache-2.0
`;
}
var APACHE_LICENSE = `                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work.

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to the Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by the Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding any notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   Copyright 2024 Hasna

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
`;
function ensureDir2(dir) {
  if (!existsSync8(dir)) {
    mkdirSync6(dir, { recursive: true });
  }
}
function createSetupTasks(name, dir) {
  console.log(source_default.dim("  Creating setup tasks from template..."));
  const initResult = execSafe(`bun -e "const { initBuiltinTemplates } = require('@hasna/todos'); initBuiltinTemplates(); console.log('ok');" 2>/dev/null`, 15000);
  if (initResult !== null && initResult.includes("ok")) {
    console.log(source_default.dim("  Builtin templates initialized."));
  }
  const projectResult = spawnSafe("todos", ["--json", "projects", "--add", dir, "--name", name], 15000);
  let projectId = null;
  if (projectResult !== null) {
    try {
      const project = JSON.parse(projectResult);
      projectId = project.id;
      console.log(source_default.dim(`  Todos project created: ${project.name} (${project.id.slice(0, 8)})`));
    } catch {
      console.log(source_default.yellow("  Could not parse todos project output."));
    }
  } else {
    console.log(source_default.yellow("  todos CLI not available \u2014 skipping setup tasks."));
    return;
  }
  if (!projectId) {
    console.log(source_default.yellow("  Could not create todos project \u2014 skipping setup tasks."));
    return;
  }
  const templatesResult = execSafe(`todos --json templates 2>/dev/null`, 15000);
  let templateId = null;
  if (templatesResult !== null) {
    try {
      const templates = JSON.parse(templatesResult);
      const osTemplate = templates.find((t) => t.name === "open-source-project");
      if (osTemplate) {
        templateId = osTemplate.id;
      }
    } catch {}
  }
  if (!templateId) {
    console.log(source_default.yellow("  open-source-project template not found \u2014 skipping setup tasks."));
    return;
  }
  const idShape = /^[A-Za-z0-9_-]{1,64}$/;
  if (!idShape.test(templateId) || !idShape.test(projectId)) {
    console.log(source_default.yellow("  Refusing to create tasks: template/project id from the todos CLI failed validation \u2014 create tasks manually."));
    return;
  }
  const tasksResult = spawnSafe("bun", [
    "-e",
    "const { tasksFromTemplate } = require('@hasna/todos'); const [templateId, projectId, name] = process.argv.slice(1); const tasks = tasksFromTemplate(templateId, projectId, { name, org: 'hasna' }); console.log(JSON.stringify({ count: tasks.length }));",
    templateId,
    projectId,
    name
  ], 15000);
  if (tasksResult !== null) {
    try {
      const result = JSON.parse(tasksResult);
      console.log(source_default.green(`  Created ${result.count} setup tasks from open-source-project template.`));
    } catch {
      console.log(source_default.yellow("  Tasks may have been created (could not parse output)."));
    }
  } else {
    console.log(source_default.yellow("  Could not create tasks from template \u2014 run manually."));
  }
}
async function scaffoldService(name, baseDir, skipTasks, opts) {
  const dir = join9(baseDir, `open-${name}`);
  console.log(source_default.bold(`
agency new service ${name}
`));
  if (existsSync8(dir)) {
    console.error(source_default.red(`  Directory already exists: ${dir}`));
    process.exit(1);
  }
  console.log(source_default.dim("  Creating directory structure..."));
  ensureDir2(dir);
  ensureDir2(join9(dir, "src", "db"));
  ensureDir2(join9(dir, "src", "mcp"));
  ensureDir2(join9(dir, "src", "cli"));
  ensureDir2(join9(dir, "src", "server"));
  console.log(source_default.dim("  Generating files..."));
  writeFileSync5(join9(dir, "package.json"), packageJson(name, "service"));
  writeFileSync5(join9(dir, "tsconfig.json"), tsconfig());
  writeFileSync5(join9(dir, "LICENSE"), APACHE_LICENSE);
  writeFileSync5(join9(dir, "README.md"), readmeTemplate(name, "service"));
  writeFileSync5(join9(dir, "src", "index.ts"), libIndexTs(name));
  writeFileSync5(join9(dir, "src", "db", "database.ts"), databaseTs(name));
  writeFileSync5(join9(dir, "src", "db", "pg-migrations.ts"), pgMigrationsTs());
  writeFileSync5(join9(dir, "src", "mcp", "index.ts"), mcpIndexTs(name));
  writeFileSync5(join9(dir, "src", "cli", "index.ts"), cliIndexTs(name));
  writeFileSync5(join9(dir, "src", "server", "index.ts"), serverIndexTs(name));
  writeFileSync5(join9(dir, ".gitignore"), `node_modules/
dist/
*.db
*.db-journal
*.db-wal
.secrets/
`);
  console.log(source_default.green("  Files generated."));
  console.log(source_default.dim("  Installing dependencies..."));
  const installResult = spawnSafe("bun", ["install"], 60000, {}, dir);
  if (installResult !== null) {
    console.log(source_default.green("  Dependencies installed."));
  } else {
    console.log(source_default.yellow("  bun install failed \u2014 run manually."));
  }
  console.log(source_default.dim("  Initializing git..."));
  spawnSafe("git", ["init", "-q"], 15000, {}, dir);
  spawnSafe("git", ["add", "-A"], 15000, {}, dir);
  spawnSafe("git", ["commit", "-q", "-m", `feat: scaffold ${name}`], 15000, {}, dir);
  if (opts.createRepo) {
    console.log(source_default.dim("  Creating GitHub repo..."));
    const ghResult = spawnSafe("gh", ["repo", "create", `hasna/${name}`, "--public", "--source", ".", "--push", "--description", `TODO: describe ${name}`], 30000);
    if (ghResult !== null) {
      console.log(source_default.green(`  GitHub repo created: https://github.com/hasna/${name}`));
    } else {
      console.log(source_default.yellow("  GitHub repo creation failed \u2014 create manually."));
    }
  } else {
    console.log(source_default.dim("  Skipping GitHub repo creation (pass --create-repo to create hasna/" + name + " on GitHub)."));
  }
  let provisionFailed = false;
  if (opts.provisionDb) {
    console.log(source_default.dim("  Creating RDS database..."));
    const pgHost = process.env["CLOUD_PG_HOST"] || process.env["HASNA_RDS_HOST"];
    const pgUser = process.env["CLOUD_PG_USER"] || process.env["HASNA_RDS_USER"] || "hasna_admin";
    const pgPassword = process.env["CLOUD_PG_PASSWORD"] || process.env["HASNA_RDS_PASSWORD"] || "";
    const dbName = name.replace(/-/g, "_");
    if (pgHost && pgPassword) {
      const createDbResult = await spawnWithTimeout("psql", ["-h", pgHost, "-U", pgUser, "-d", "postgres", "-c", `CREATE DATABASE ${dbName};`], 15000, { PGPASSWORD: pgPassword });
      if (createDbResult.code === 0 && !createDbResult.stderr.includes("ERROR")) {
        console.log(source_default.green(`  RDS database created: ${dbName}`));
      } else {
        provisionFailed = true;
        console.error(source_default.red(`  RDS database creation FAILED for ${dbName} \u2014 refusing to report success.`));
      }
    } else {
      provisionFailed = true;
      console.error(source_default.red("  RDS not configured (CLOUD_PG_HOST / CLOUD_PG_PASSWORD unset) while --provision-db was requested \u2014 refusing to report success."));
    }
  } else {
    console.log(source_default.dim("  Skipping RDS database provisioning (pass --provision-db to enable)."));
  }
  if (opts.publish) {
    console.error(source_default.red("  Refusing to publish from a scaffold: publication requires the reviewed hasna/apps pipeline (changeset PR -> adversarial review -> publish intent -> npm)."));
    process.exitCode = 1;
  } else {
    console.log(source_default.dim("  Skipping npm publish."));
  }
  if (opts.createTasks) {
    createSetupTasks(name, dir);
  } else {
    console.log(source_default.dim("  Skipping setup tasks (pass --create-tasks to create a todos project and setup tasks)."));
  }
  if (provisionFailed) {
    console.error(source_default.red(`
  open-${name} scaffolded with failures (see above) \u2014 fix and re-run.`));
    process.exitCode = 1;
    return;
  }
  console.log(source_default.bold.green(`
  open-${name} scaffolded successfully.
`));
  console.log(source_default.dim(`  Directory: ${dir}`));
  console.log(source_default.dim(`  Package:   @hasna/${name}`));
  console.log(source_default.dim(`  CLI:       ${name}`));
  console.log(source_default.dim(`  MCP:       ${name}-mcp`));
  console.log(source_default.dim(`  Server:    ${name}-serve`));
}
async function scaffoldLibrary(name, baseDir, skipTasks, opts) {
  const dir = join9(baseDir, `open-${name}`);
  console.log(source_default.bold(`
agency new library ${name}
`));
  if (existsSync8(dir)) {
    console.error(source_default.red(`  Directory already exists: ${dir}`));
    process.exit(1);
  }
  console.log(source_default.dim("  Creating directory structure..."));
  ensureDir2(dir);
  ensureDir2(join9(dir, "src"));
  console.log(source_default.dim("  Generating files..."));
  writeFileSync5(join9(dir, "package.json"), packageJson(name, "library"));
  writeFileSync5(join9(dir, "tsconfig.json"), tsconfig());
  writeFileSync5(join9(dir, "LICENSE"), APACHE_LICENSE);
  writeFileSync5(join9(dir, "README.md"), readmeTemplate(name, "library"));
  writeFileSync5(join9(dir, "src", "index.ts"), `// ---------------------------------------------------------------------------
// @hasna/${name} \u2014 Library exports
// ---------------------------------------------------------------------------

export {};
`);
  writeFileSync5(join9(dir, ".gitignore"), `node_modules/
dist/
.secrets/
`);
  console.log(source_default.green("  Files generated."));
  console.log(source_default.dim("  Installing dependencies..."));
  const installResult = spawnSafe("bun", ["install"], 60000, {}, dir);
  if (installResult !== null) {
    console.log(source_default.green("  Dependencies installed."));
  } else {
    console.log(source_default.yellow("  bun install failed \u2014 run manually."));
  }
  console.log(source_default.dim("  Initializing git..."));
  spawnSafe("git", ["init", "-q"], 15000, {}, dir);
  spawnSafe("git", ["add", "-A"], 15000, {}, dir);
  spawnSafe("git", ["commit", "-q", "-m", `feat: scaffold ${name}`], 15000, {}, dir);
  if (opts.createRepo) {
    console.log(source_default.dim("  Creating GitHub repo..."));
    const ghResult = spawnSafe("gh", ["repo", "create", `hasna/${name}`, "--public", "--source", ".", "--push", "--description", `TODO: describe ${name}`], 30000);
    if (ghResult !== null) {
      console.log(source_default.green(`  GitHub repo created: https://github.com/hasna/${name}`));
    } else {
      console.log(source_default.yellow("  GitHub repo creation failed \u2014 create manually."));
    }
  } else {
    console.log(source_default.dim("  Skipping GitHub repo creation (pass --create-repo to create hasna/" + name + " on GitHub)."));
  }
  if (opts.publish) {
    console.error(source_default.red("  Refusing to publish from a scaffold: publication requires the reviewed hasna/apps pipeline (changeset PR -> adversarial review -> publish intent -> npm)."));
    process.exitCode = 1;
  } else {
    console.log(source_default.dim("  Skipping npm publish."));
  }
  if (opts.createTasks) {
    createSetupTasks(name, dir);
  } else {
    console.log(source_default.dim("  Skipping setup tasks (pass --create-tasks to create a todos project and setup tasks)."));
  }
  console.log(source_default.bold.green(`
  open-${name} scaffolded successfully.
`));
  console.log(source_default.dim(`  Directory: ${dir}`));
  console.log(source_default.dim(`  Package:   @hasna/${name}`));
}
function registerNewCommand(program2) {
  const newCmd = program2.command("new").description("Scaffold a new @hasna/* package (service or library)");
  newCmd.command("service <name>").description("Create a new service with CLI, MCP server, HTTP server, and database").option("-d, --dir <path>", "Base directory for the new project", process.cwd()).option("--skip-tasks", "Skip creating setup tasks from the open-source-project template").option("--create-tasks", "Create a todos project and setup tasks (default: local-only scaffold, no external records)").option("--create-repo", "Refused: remote repo creation is removed (use the reviewed hasna/apps pipeline)").option("--provision-db", "Provision an RDS database for the service").option("--publish", "Refused: scaffold publication is removed (use the reviewed hasna/apps pipeline)").action(async (name, opts) => {
    const baseDir = resolve4(opts.dir);
    assertSafeScaffoldName(name);
    if (opts.createRepo) {
      console.error(source_default.red("  Refusing to create a GitHub repo from a scaffold: remote effects require the reviewed hasna/apps pipeline."));
      process.exitCode = 1;
    }
    await scaffoldService(name, baseDir, !!opts.skipTasks, {
      createRepo: false,
      provisionDb: !!opts.provisionDb,
      publish: !!opts.publish,
      createTasks: !!opts.createTasks
    });
  });
  newCmd.command("library <name>").description("Create a new library package (no DB, MCP, CLI, or server)").option("-d, --dir <path>", "Base directory for the new project", process.cwd()).option("--skip-tasks", "Skip creating setup tasks from the open-source-project template").option("--create-tasks", "Create a todos project and setup tasks (default: local-only scaffold, no external records)").option("--create-repo", "Refused: remote repo creation is removed (use the reviewed hasna/apps pipeline)").option("--publish", "Refused: scaffold publication is removed (use the reviewed hasna/apps pipeline)").action(async (name, opts) => {
    const baseDir = resolve4(opts.dir);
    assertSafeScaffoldName(name);
    if (opts.createRepo) {
      console.error(source_default.red("  Refusing to create a GitHub repo from a scaffold: remote effects require the reviewed hasna/apps pipeline."));
      process.exitCode = 1;
    }
    await scaffoldLibrary(name, baseDir, !!opts.skipTasks, {
      createRepo: false,
      provisionDb: false,
      publish: !!opts.publish,
      createTasks: !!opts.createTasks
    });
  });
}
function assertSafeScaffoldName(name) {
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(name)) {
    console.error(source_default.red(`  Invalid package name: ${JSON.stringify(name)} \u2014 must match ^[a-z][a-z0-9-]{0,62}$`));
    process.exit(1);
  }
}

// src/commands/release.ts
import { existsSync as existsSync9, mkdirSync as mkdirSync7, readFileSync as readFileSync5, rmSync, writeFileSync as writeFileSync6, readdirSync as readdirSync7, statSync as statSync8, unlinkSync as unlinkSync2 } from "fs";
import { basename as basename2, join as join10, resolve as resolve5 } from "path";
import { tmpdir } from "os";
function findOpenRepos(baseDir) {
  if (!existsSync9(baseDir))
    return [];
  try {
    return readdirSync7(baseDir).filter((entry) => {
      if (!entry.startsWith("open-"))
        return false;
      const full = join10(baseDir, entry);
      return statSync8(full).isDirectory() && existsSync9(join10(full, "package.json"));
    }).sort();
  } catch {
    return [];
  }
}
function getRepoInfo(dir) {
  const pkgPath = join10(dir, "package.json");
  if (!existsSync9(pkgPath))
    return null;
  try {
    const pkg = JSON.parse(readFileSync5(pkgPath, "utf8"));
    const name = basename2(dir).replace(/^open-/, "");
    const currentVersion = pkg.version || "0.0.0";
    const porcelain = spawnSafe("git", ["status", "--porcelain"], 1e4, {}, dir);
    if (porcelain === null) {
      return { name, dir, packageName: pkg.name || "", currentVersion, hasChanges: false, unpushedCommits: 0, needsRelease: false, gitStatusFailed: true };
    }
    const hasChanges = porcelain.length > 0;
    let unpushedCommits = 0;
    const revCount = spawnSafe("git", ["rev-list", "--count", "@{u}..HEAD"], 1e4, {}, dir);
    if (revCount !== null && !revCount.includes("fatal") && !revCount.includes("error")) {
      unpushedCommits = parseInt(revCount, 10) || 0;
    }
    const needsRelease = hasChanges || unpushedCommits > 0;
    return { name, dir, packageName: pkg.name || "", currentVersion, hasChanges, unpushedCommits, needsRelease };
  } catch {
    return null;
  }
}
var NPM_VULNERABILITY_EGRESS = "//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\n";
function packPattern(label, ...fragments) {
  return { label, re: new RegExp(fragments.join("")) };
}
var FORBIDDEN_PACK_PATTERNS = [
  packPattern("internal-infra domain suffix", "has", "na", "\\.", "x", "yz"),
  packPattern("AWS resource name", "ar", "n", ":", "aw", "s", ":"),
  { label: "12-digit AWS account id", re: /\b\d{12}\b/ },
  { label: "npm credential value", re: /npm_[A-Za-z0-9]{20,}/ },
  packPattern("Anthropic credential value", "sk", "-", "ant", "-", "[A-Za-z0-9_-]{10,}"),
  packPattern("OpenAI credential value", "sk", "-", "proj", "-", "[A-Za-z0-9_-]{10,}"),
  packPattern("private-scope string", "has", "na", "-", "internal"),
  packPattern("internal-tree string", "internal", "-", "apps"),
  { label: "GitHub credential value", re: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { label: "GitHub fine-grained token", re: /github_pat_[A-Za-z0-9_]{20,}/ },
  { label: "Google API key value", re: /AIza[A-Za-z0-9_-]{20,}/ },
  { label: "AWS access key id", re: /AKIA[0-9A-Z]{16}/ },
  { label: "xAI credential value", re: /xai-[A-Za-z0-9_-]{10,}/ }
];
function walkPackedEntries(root) {
  const out = [];
  const walk = (dir, prefix) => {
    const entries = readdirSync7(dir);
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry}` : entry;
      const full = join10(dir, entry);
      if (statSync8(full).isDirectory())
        walk(full, rel);
      else
        out.push(rel);
    }
  };
  walk(root, "");
  return out;
}
var PACK_METADATA_ENTRIES = new Set(["package.json", "README.md", "README", "LICENSE", "LICENSE.md", "LICENSE.txt"]);
var FORBIDDEN_PACK_ENTRY = /(^|\/)\.env($|\.)|(^|\/)node_modules($|\/)|(^|\/)\.git($|\/)/;
function packVerifiedTarball(info) {
  let sourcePkg;
  try {
    sourcePkg = JSON.parse(readFileSync5(join10(info.dir, "package.json"), "utf8"));
  } catch {
    return { tarball: "", error: "source package.json is not parseable \u2014 nothing was published" };
  }
  const sourceFiles = sourcePkg.files;
  if (!Array.isArray(sourceFiles) || sourceFiles.length === 0) {
    return {
      tarball: "",
      error: "the reviewed source manifest has no `files` array \u2014 nothing was published"
    };
  }
  const buildEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === "NODE_AUTH_TOKEN")
      continue;
    if (v !== undefined)
      buildEnv[k] = v;
  }
  buildEnv.NODE_AUTH_TOKEN = undefined;
  const buildResult = spawnSafe("bun", ["run", "build"], 60000, buildEnv, info.dir);
  if (buildResult === null) {
    return { tarball: "", error: "build failed \u2014 nothing was packed or published" };
  }
  const afterBuild = spawnSafe("git", ["status", "--porcelain"], 1e4, {}, info.dir);
  if (afterBuild === null) {
    return { tarball: "", error: "could not verify the worktree stayed clean after the build \u2014 nothing was published" };
  }
  if (afterBuild.trim().length > 0) {
    return {
      tarball: "",
      error: `worktree is dirty after the build (${afterBuild.trim().split(`
`)[0].slice(0, 80)}) \u2014 the build mutated the reviewed tree \u2014 nothing was published`
    };
  }
  const packResult = spawnSafe("npm", ["pack", "--json", "--ignore-scripts"], 60000, buildEnv, info.dir);
  if (packResult === null) {
    return { tarball: "", error: "npm pack failed \u2014 nothing was published" };
  }
  let manifest = null;
  try {
    const parsed = JSON.parse(packResult);
    manifest = Array.isArray(parsed) ? parsed[0] : parsed;
  } catch {
    return { tarball: "", error: "npm pack output was not parseable \u2014 nothing was published" };
  }
  const expectedName = `@hasna/${info.name}`;
  if (!manifest || manifest.name !== expectedName || manifest.version !== info.currentVersion || !manifest.filename) {
    return {
      tarball: "",
      error: `packed artifact does not match the reviewed candidate: expected ${expectedName}@${info.currentVersion}, packed ${manifest?.name ?? "unknown"}@${manifest?.version ?? "unknown"} \u2014 nothing was published`
    };
  }
  const tarball = join10(info.dir, manifest.filename);
  const extractDir = join10(tmpdir(), `.agency-pack-scan-${process.pid}`);
  mkdirSync7(extractDir, { recursive: true });
  try {
    const extract = spawnSafe("tar", ["-xzf", tarball, "-C", extractDir], 30000, {}, info.dir);
    if (extract === null) {
      return { tarball: "", error: "could not inspect the packed artifact (tar extraction failed) \u2014 nothing was published" };
    }
    const packedRoot = join10(extractDir, "package");
    let packedPkg;
    try {
      packedPkg = JSON.parse(readFileSync5(join10(packedRoot, "package.json"), "utf8"));
    } catch {
      return { tarball: "", error: "packed package.json is not parseable \u2014 nothing was published" };
    }
    if (JSON.stringify(packedPkg) !== JSON.stringify(sourcePkg)) {
      return {
        tarball: "",
        error: "packed package.json differs from the reviewed source manifest \u2014 nothing was published"
      };
    }
    let entries;
    try {
      entries = walkPackedEntries(packedRoot);
    } catch {
      return { tarball: "", error: "packed artifact could not be fully inspected (unreadable entry) \u2014 nothing was published" };
    }
    for (const rel of entries) {
      if (PACK_METADATA_ENTRIES.has(rel))
        continue;
      if (FORBIDDEN_PACK_ENTRY.test(rel)) {
        return { tarball: "", error: `packed artifact contains a forbidden entry (${rel}) \u2014 nothing was published` };
      }
      const covered = sourceFiles.some((f) => {
        const clean = f.replace(/\/+$/, "");
        return rel === clean || rel.startsWith(`${clean}/`);
      });
      if (!covered) {
        return { tarball: "", error: `packed artifact contains an undeclared entry (${rel}) outside the reviewed file set \u2014 nothing was published` };
      }
    }
    for (const rel of entries) {
      const content = readFileSync5(join10(packedRoot, rel), "utf8");
      for (const pattern of FORBIDDEN_PACK_PATTERNS) {
        if (pattern.re.test(content)) {
          return { tarball: "", error: `packed artifact contains ${pattern.label} in ${rel} \u2014 nothing was published` };
        }
      }
    }
  } finally {
    try {
      rmSync(extractDir, { recursive: true, force: true });
    } catch {}
  }
  return { tarball, error: null };
}
function publishViaVault(info, tarball) {
  if (!binaryExists("secrets")) {
    return "refusing to release: secrets CLI not found \u2014 publish requires the vault-backed route (secrets exec hasna/npm/live/publish-token)";
  }
  const npmrcPath = join10(tmpdir(), `.agency-release-${process.pid}.npmrc`);
  try {
    writeFileSync6(npmrcPath, NPM_VULNERABILITY_EGRESS, { mode: 384 });
    const result = spawnSafe("secrets", ["exec", "hasna/npm/live/publish-token", "--as", "NODE_AUTH_TOKEN", "--", "npm", "publish", tarball, "--userconfig", npmrcPath, "--access", "public", "--ignore-scripts"], 60000, { NODE_AUTH_TOKEN: undefined }, info.dir);
    if (result === null) {
      return `npm publish failed for ${tarball} \u2014 nothing was published`;
    }
    return null;
  } finally {
    try {
      unlinkSync2(npmrcPath);
    } catch {}
  }
}
function releaseRepo(info, reviewedSha) {
  const newVersion = info.currentVersion;
  if (!reviewedSha) {
    return {
      name: info.name,
      oldVersion: info.currentVersion,
      newVersion,
      status: "failed",
      error: "refusing to release: --reviewed-sha <sha> is required (must equal the current HEAD of the reviewed candidate)"
    };
  }
  if (info.packageName !== `@hasna/${info.name}`) {
    return {
      name: info.name,
      oldVersion: info.currentVersion,
      newVersion,
      status: "failed",
      error: `refusing to release: package.json declares ${info.packageName || "(missing name)"}, expected @hasna/${info.name} \u2014 the published identity must match the reviewed candidate`
    };
  }
  if (!/^\d+\.\d+\.\d+/.test(info.currentVersion)) {
    return {
      name: info.name,
      oldVersion: info.currentVersion,
      newVersion,
      status: "failed",
      error: `refusing to release: package version ${info.currentVersion} is not semver \u2014 the reviewed candidate must carry a concrete version`
    };
  }
  const head = spawnSafe("git", ["rev-parse", "HEAD"], 1e4, {}, info.dir);
  if (head === null || head.trim() !== reviewedSha) {
    return {
      name: info.name,
      oldVersion: info.currentVersion,
      newVersion,
      status: "failed",
      error: `refusing to release: HEAD (${head ? head.trim().slice(0, 12) : "unknown"}) does not match --reviewed-sha ${reviewedSha.slice(0, 12)} \u2014 the release must be bound to the reviewed commit`
    };
  }
  const porcelain = spawnSafe("git", ["status", "--porcelain"], 1e4, {}, info.dir);
  if (porcelain === null) {
    return {
      name: info.name,
      oldVersion: info.currentVersion,
      newVersion,
      status: "failed",
      error: "refusing to release: could not verify the worktree is clean (git status failed) \u2014 the reviewed candidate must be exactly HEAD"
    };
  }
  if (porcelain.trim().length > 0) {
    return {
      name: info.name,
      oldVersion: info.currentVersion,
      newVersion,
      status: "failed",
      error: `refusing to release: worktree is not clean (${porcelain.split(`
`)[0]}) \u2014 the reviewed candidate must be exactly HEAD`
    };
  }
  if (!binaryExists("secrets")) {
    return {
      name: info.name,
      oldVersion: info.currentVersion,
      newVersion,
      status: "failed",
      error: "refusing to release: secrets CLI not found \u2014 publish requires the vault-backed route (secrets exec hasna/npm/live/publish-token)"
    };
  }
  const packed = packVerifiedTarball(info);
  if (packed.error !== null || packed.tarball === "") {
    return { name: info.name, oldVersion: info.currentVersion, newVersion, status: "failed", error: packed.error ?? "pack failed" };
  }
  const publishError = publishViaVault(info, packed.tarball);
  if (publishError !== null) {
    return { name: info.name, oldVersion: info.currentVersion, newVersion, status: "failed", error: publishError };
  }
  return { name: info.name, oldVersion: info.currentVersion, newVersion, status: "published" };
}
function registerReleaseCommand(program2) {
  program2.command("release [repo]").description("Bump patch version, build, commit, publish a SHA-bound reviewed @hasna/* repo").option("--dry-run", "Show what would be published without doing it").option("--check", "Just show repos with unpushed changes").option("--reviewed-sha <sha>", "Exact reviewed commit SHA the release must be bound to (required for real publishes)").option("-d, --dir <path>", "Base directory containing open-* repos", process.cwd()).action((repo, opts) => {
    const baseDir = resolve5(opts.dir);
    console.log(source_default.bold("agency release") + source_default.dim(` \u2014 scanning ${baseDir}
`));
    const repoDirs = findOpenRepos(baseDir);
    if (repoDirs.length === 0) {
      console.log(source_default.yellow("  No open-* repos found in this directory."));
      return;
    }
    let infos = [];
    for (const repoDir of repoDirs) {
      const info = getRepoInfo(join10(baseDir, repoDir));
      if (info)
        infos.push(info);
    }
    for (const info of infos) {
      if (info.gitStatusFailed) {
        console.log(source_default.red(`  ${info.name}: could not verify git status \u2014 refusing (the release candidate must be exactly the reviewed HEAD)`));
      }
    }
    if (repo) {
      const normalizedRepo = repo.replace(/^open-/, "");
      infos = infos.filter((i) => i.name === normalizedRepo || i.name === repo);
      if (infos.length === 0) {
        console.error(source_default.red(`  Repo not found: ${repo}`));
        console.log(source_default.dim(`  Available: ${repoDirs.map((d) => d.replace("open-", "")).join(", ")}`));
        process.exit(1);
      }
    }
    const unverifiableSelected = infos.filter((i) => i.gitStatusFailed).length;
    if (opts.check) {
      console.log(source_default.bold(pad("Package", 22) + pad("Version", 12) + pad("Changes", 10) + pad("Unpushed", 10) + pad("Status", 14)));
      console.log(source_default.dim("\u2500".repeat(68)));
      for (const info of infos) {
        const status = info.gitStatusFailed ? source_default.red("status failed") : info.needsRelease ? source_default.yellow("needs release") : source_default.green("clean");
        console.log(pad(info.name, 22) + pad(info.currentVersion, 12) + pad(info.hasChanges ? source_default.yellow("yes") : source_default.dim("no"), 10) + pad(info.unpushedCommits > 0 ? source_default.yellow(String(info.unpushedCommits)) : source_default.dim("0"), 10) + status);
      }
      const needsRelease = infos.filter((i) => i.needsRelease).length;
      console.log(source_default.dim(`
  ${infos.length} repos scanned, ${needsRelease} need release.`));
      if (unverifiableSelected > 0) {
        process.exitCode = 1;
      }
      return;
    }
    const verified = infos.filter((i) => !i.gitStatusFailed);
    let candidates = verified;
    if (verified.length === 0) {
      const unverifiable = infos.filter((i) => i.gitStatusFailed).length;
      if (unverifiable > 0) {
        console.log(source_default.yellow(`  ${unverifiable} repo(s) could not be verified (git status failed); nothing released.`));
        process.exitCode = 1;
      } else {
        console.log(source_default.green("  All repos are clean. Nothing to release."));
      }
      return;
    }
    if (!repo && opts.reviewedSha) {
      const sha = opts.reviewedSha;
      const atSha = [];
      const others = [];
      for (const info of verified) {
        const head = spawnSafe("git", ["rev-parse", "HEAD"], 1e4, {}, info.dir);
        if (head !== null && head.trim() === sha)
          atSha.push(info);
        else
          others.push(info);
      }
      for (const info of others) {
        console.log(source_default.dim(`  ${info.name}: HEAD is not --reviewed-sha ${sha.slice(0, 12)} \u2014 skipped`));
      }
      if (atSha.length === 0) {
        console.log(source_default.yellow(`  No repo is at --reviewed-sha ${sha.slice(0, 12)}; nothing released.`));
        process.exitCode = 1;
        return;
      }
      candidates = atSha;
    }
    if (opts.dryRun) {
      console.log(source_default.bold(`  Dry run \u2014 the following repos would be released at their reviewed SHA:
`));
      console.log(source_default.bold(pad("Package", 22) + pad("Version", 12) + pad("Changes", 10)));
      console.log(source_default.dim("\u2500".repeat(44)));
      for (const info of candidates) {
        console.log(pad(info.name, 22) + pad(info.currentVersion, 12) + pad([
          info.hasChanges ? "uncommitted" : "",
          info.unpushedCommits > 0 ? `${info.unpushedCommits} unpushed` : ""
        ].filter(Boolean).join(", ") || "clean", 10));
      }
      console.log(source_default.dim(`
  ${candidates.length} repo(s) would be released.`));
      console.log(source_default.dim("  Run with --reviewed-sha <sha> to publish the exact reviewed commit."));
      if (unverifiableSelected > 0) {
        process.exitCode = 1;
      }
      return;
    }
    console.log(source_default.dim(`  Releasing ${candidates.length} repo(s)...
`));
    const results = [];
    for (const info of candidates) {
      process.stdout.write(source_default.dim(`  ${info.name} ${info.currentVersion} ... `));
      const result = releaseRepo(info, opts.reviewedSha);
      results.push(result);
      if (result.status === "published") {
        console.log(source_default.green("published"));
      } else if (result.status === "skipped") {
        console.log(source_default.dim("skipped"));
      } else {
        console.log(source_default.red(`failed: ${result.error || "unknown"}`));
      }
    }
    console.log(source_default.bold(`
  Release summary:
`));
    console.log(source_default.bold(pad("Package", 22) + pad("Old", 12) + pad("New", 12) + pad("Status", 14)));
    console.log(source_default.dim("\u2500".repeat(60)));
    for (const result of results) {
      const statusStr = result.status === "published" ? source_default.green("published") : result.status === "skipped" ? source_default.dim("skipped") : source_default.red("failed");
      console.log(pad(result.name, 22) + pad(result.oldVersion, 12) + pad(result.newVersion, 12) + statusStr);
    }
    const published = results.filter((r) => r.status === "published").length;
    const failed = results.filter((r) => r.status === "failed").length;
    console.log(source_default.dim(`
  ${published} published, ${failed} failed, ${results.length - published - failed} skipped.`));
    if (failed > 0) {
      process.exitCode = 1;
    }
    if (unverifiableSelected > 0) {
      process.exitCode = 1;
    }
  });
}

// src/index.ts
var require2 = createRequire(import.meta.url);
var pkg = require2("../package.json");
var program2 = new Command;
program2.name("agency").description(`Unified management CLI for all ${PACKAGE_COUNT} @hasna/* open-source packages`).version(pkg.version);
registerStatusCommand(program2);
registerDoctorCommand(program2);
registerInitCommand(program2);
registerUpdateCommand(program2);
registerSyncCommand(program2);
registerMcpCommand(program2);
registerBackupCommand(program2);
registerDbCommand(program2);
registerConnectCommand(program2);
registerPlaygroundCommand(program2);
registerLogsCommand(program2);
registerSearchCommand(program2);
registerExportCommand(program2);
registerNewCommand(program2);
registerReleaseCommand(program2);
program2.parse();
