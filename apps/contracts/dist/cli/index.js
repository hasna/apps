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
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
var __require = import.meta.require;

// ../../node_modules/.bun/commander@13.1.0/node_modules/commander/lib/error.js
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

// ../../node_modules/.bun/commander@13.1.0/node_modules/commander/lib/argument.js
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

// ../../node_modules/.bun/commander@13.1.0/node_modules/commander/lib/help.js
var require_help = __commonJS((exports) => {
  var { humanReadableArgName } = require_argument();

  class Help {
    constructor() {
      this.helpWidth = undefined;
      this.minWidthToWrap = 40;
      this.sortSubcommands = false;
      this.sortOptions = false;
      this.showGlobalOptions = false;
    }
    prepareContext(contextOptions) {
      this.helpWidth = this.helpWidth ?? contextOptions.helpWidth ?? 80;
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
        return Math.max(max, this.displayWidth(helper.styleSubcommandTerm(helper.subcommandTerm(command))));
      }, 0);
    }
    longestOptionTermLength(cmd, helper) {
      return helper.visibleOptions(cmd).reduce((max, option) => {
        return Math.max(max, this.displayWidth(helper.styleOptionTerm(helper.optionTerm(option))));
      }, 0);
    }
    longestGlobalOptionTermLength(cmd, helper) {
      return helper.visibleGlobalOptions(cmd).reduce((max, option) => {
        return Math.max(max, this.displayWidth(helper.styleOptionTerm(helper.optionTerm(option))));
      }, 0);
    }
    longestArgumentTermLength(cmd, helper) {
      return helper.visibleArguments(cmd).reduce((max, argument) => {
        return Math.max(max, this.displayWidth(helper.styleArgumentTerm(helper.argumentTerm(argument))));
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
        const extraDescription = `(${extraInfo.join(", ")})`;
        if (argument.description) {
          return `${argument.description} ${extraDescription}`;
        }
        return extraDescription;
      }
      return argument.description;
    }
    formatHelp(cmd, helper) {
      const termWidth = helper.padWidth(cmd, helper);
      const helpWidth = helper.helpWidth ?? 80;
      function callFormatItem(term, description) {
        return helper.formatItem(term, termWidth, description, helper);
      }
      let output = [
        `${helper.styleTitle("Usage:")} ${helper.styleUsage(helper.commandUsage(cmd))}`,
        ""
      ];
      const commandDescription = helper.commandDescription(cmd);
      if (commandDescription.length > 0) {
        output = output.concat([
          helper.boxWrap(helper.styleCommandDescription(commandDescription), helpWidth),
          ""
        ]);
      }
      const argumentList = helper.visibleArguments(cmd).map((argument) => {
        return callFormatItem(helper.styleArgumentTerm(helper.argumentTerm(argument)), helper.styleArgumentDescription(helper.argumentDescription(argument)));
      });
      if (argumentList.length > 0) {
        output = output.concat([
          helper.styleTitle("Arguments:"),
          ...argumentList,
          ""
        ]);
      }
      const optionList = helper.visibleOptions(cmd).map((option) => {
        return callFormatItem(helper.styleOptionTerm(helper.optionTerm(option)), helper.styleOptionDescription(helper.optionDescription(option)));
      });
      if (optionList.length > 0) {
        output = output.concat([
          helper.styleTitle("Options:"),
          ...optionList,
          ""
        ]);
      }
      if (helper.showGlobalOptions) {
        const globalOptionList = helper.visibleGlobalOptions(cmd).map((option) => {
          return callFormatItem(helper.styleOptionTerm(helper.optionTerm(option)), helper.styleOptionDescription(helper.optionDescription(option)));
        });
        if (globalOptionList.length > 0) {
          output = output.concat([
            helper.styleTitle("Global Options:"),
            ...globalOptionList,
            ""
          ]);
        }
      }
      const commandList = helper.visibleCommands(cmd).map((cmd2) => {
        return callFormatItem(helper.styleSubcommandTerm(helper.subcommandTerm(cmd2)), helper.styleSubcommandDescription(helper.subcommandDescription(cmd2)));
      });
      if (commandList.length > 0) {
        output = output.concat([
          helper.styleTitle("Commands:"),
          ...commandList,
          ""
        ]);
      }
      return output.join(`
`);
    }
    displayWidth(str) {
      return stripColor(str).length;
    }
    styleTitle(str) {
      return str;
    }
    styleUsage(str) {
      return str.split(" ").map((word) => {
        if (word === "[options]")
          return this.styleOptionText(word);
        if (word === "[command]")
          return this.styleSubcommandText(word);
        if (word[0] === "[" || word[0] === "<")
          return this.styleArgumentText(word);
        return this.styleCommandText(word);
      }).join(" ");
    }
    styleCommandDescription(str) {
      return this.styleDescriptionText(str);
    }
    styleOptionDescription(str) {
      return this.styleDescriptionText(str);
    }
    styleSubcommandDescription(str) {
      return this.styleDescriptionText(str);
    }
    styleArgumentDescription(str) {
      return this.styleDescriptionText(str);
    }
    styleDescriptionText(str) {
      return str;
    }
    styleOptionTerm(str) {
      return this.styleOptionText(str);
    }
    styleSubcommandTerm(str) {
      return str.split(" ").map((word) => {
        if (word === "[options]")
          return this.styleOptionText(word);
        if (word[0] === "[" || word[0] === "<")
          return this.styleArgumentText(word);
        return this.styleSubcommandText(word);
      }).join(" ");
    }
    styleArgumentTerm(str) {
      return this.styleArgumentText(str);
    }
    styleOptionText(str) {
      return str;
    }
    styleArgumentText(str) {
      return str;
    }
    styleSubcommandText(str) {
      return str;
    }
    styleCommandText(str) {
      return str;
    }
    padWidth(cmd, helper) {
      return Math.max(helper.longestOptionTermLength(cmd, helper), helper.longestGlobalOptionTermLength(cmd, helper), helper.longestSubcommandTermLength(cmd, helper), helper.longestArgumentTermLength(cmd, helper));
    }
    preformatted(str) {
      return /\n[^\S\r\n]/.test(str);
    }
    formatItem(term, termWidth, description, helper) {
      const itemIndent = 2;
      const itemIndentStr = " ".repeat(itemIndent);
      if (!description)
        return itemIndentStr + term;
      const paddedTerm = term.padEnd(termWidth + term.length - helper.displayWidth(term));
      const spacerWidth = 2;
      const helpWidth = this.helpWidth ?? 80;
      const remainingWidth = helpWidth - termWidth - spacerWidth - itemIndent;
      let formattedDescription;
      if (remainingWidth < this.minWidthToWrap || helper.preformatted(description)) {
        formattedDescription = description;
      } else {
        const wrappedDescription = helper.boxWrap(description, remainingWidth);
        formattedDescription = wrappedDescription.replace(/\n/g, `
` + " ".repeat(termWidth + spacerWidth));
      }
      return itemIndentStr + paddedTerm + " ".repeat(spacerWidth) + formattedDescription.replace(/\n/g, `
${itemIndentStr}`);
    }
    boxWrap(str, width) {
      if (width < this.minWidthToWrap)
        return str;
      const rawLines = str.split(/\r\n|\n/);
      const chunkPattern = /[\s]*[^\s]+/g;
      const wrappedLines = [];
      rawLines.forEach((line) => {
        const chunks = line.match(chunkPattern);
        if (chunks === null) {
          wrappedLines.push("");
          return;
        }
        let sumChunks = [chunks.shift()];
        let sumWidth = this.displayWidth(sumChunks[0]);
        chunks.forEach((chunk) => {
          const visibleWidth = this.displayWidth(chunk);
          if (sumWidth + visibleWidth <= width) {
            sumChunks.push(chunk);
            sumWidth += visibleWidth;
            return;
          }
          wrappedLines.push(sumChunks.join(""));
          const nextChunk = chunk.trimStart();
          sumChunks = [nextChunk];
          sumWidth = this.displayWidth(nextChunk);
        });
        wrappedLines.push(sumChunks.join(""));
      });
      return wrappedLines.join(`
`);
    }
  }
  function stripColor(str) {
    const sgrPattern = /\x1b\[\d*(;\d*)*m/g;
    return str.replace(sgrPattern, "");
  }
  exports.Help = Help;
  exports.stripColor = stripColor;
});

// ../../node_modules/.bun/commander@13.1.0/node_modules/commander/lib/option.js
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
      if (this.negate) {
        return camelcase(this.name().replace(/^no-/, ""));
      }
      return camelcase(this.name());
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
    const shortFlagExp = /^-[^-]$/;
    const longFlagExp = /^--[^-]/;
    const flagParts = flags.split(/[ |,]+/).concat("guard");
    if (shortFlagExp.test(flagParts[0]))
      shortFlag = flagParts.shift();
    if (longFlagExp.test(flagParts[0]))
      longFlag = flagParts.shift();
    if (!shortFlag && shortFlagExp.test(flagParts[0]))
      shortFlag = flagParts.shift();
    if (!shortFlag && longFlagExp.test(flagParts[0])) {
      shortFlag = longFlag;
      longFlag = flagParts.shift();
    }
    if (flagParts[0].startsWith("-")) {
      const unsupportedFlag = flagParts[0];
      const baseError = `option creation failed due to '${unsupportedFlag}' in option flags '${flags}'`;
      if (/^-[^-][^-]/.test(unsupportedFlag))
        throw new Error(`${baseError}
- a short flag is a single dash and a single character
  - either use a single dash and a single character (for a short flag)
  - or use a double dash for a long option (and can have two, like '--ws, --workspace')`);
      if (shortFlagExp.test(unsupportedFlag))
        throw new Error(`${baseError}
- too many short flags`);
      if (longFlagExp.test(unsupportedFlag))
        throw new Error(`${baseError}
- too many long flags`);
      throw new Error(`${baseError}
- unrecognised flag format`);
    }
    if (shortFlag === undefined && longFlag === undefined)
      throw new Error(`option creation failed due to no flags found in '${flags}'.`);
    return { shortFlag, longFlag };
  }
  exports.Option = Option;
  exports.DualOptions = DualOptions;
});

// ../../node_modules/.bun/commander@13.1.0/node_modules/commander/lib/suggestSimilar.js
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

// ../../node_modules/.bun/commander@13.1.0/node_modules/commander/lib/command.js
var require_command = __commonJS((exports) => {
  var EventEmitter = __require("events").EventEmitter;
  var childProcess = __require("child_process");
  var path = __require("path");
  var fs = __require("fs");
  var process2 = __require("process");
  var { Argument, humanReadableArgName } = require_argument();
  var { CommanderError } = require_error();
  var { Help, stripColor } = require_help();
  var { Option, DualOptions } = require_option();
  var { suggestSimilar } = require_suggestSimilar();

  class Command extends EventEmitter {
    constructor(name) {
      super();
      this.commands = [];
      this.options = [];
      this.parent = null;
      this._allowUnknownOption = false;
      this._allowExcessArguments = false;
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
      this._savedState = null;
      this._outputConfiguration = {
        writeOut: (str) => process2.stdout.write(str),
        writeErr: (str) => process2.stderr.write(str),
        outputError: (str, write) => write(str),
        getOutHelpWidth: () => process2.stdout.isTTY ? process2.stdout.columns : undefined,
        getErrHelpWidth: () => process2.stderr.isTTY ? process2.stderr.columns : undefined,
        getOutHasColors: () => useColor() ?? (process2.stdout.isTTY && process2.stdout.hasColors?.()),
        getErrHasColors: () => useColor() ?? (process2.stderr.isTTY && process2.stderr.hasColors?.()),
        stripColor: (str) => stripColor(str)
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
      this._prepareForParse();
      const userArgs = this._prepareUserArgs(argv, parseOptions);
      this._parseCommand([], userArgs);
      return this;
    }
    async parseAsync(argv, parseOptions) {
      this._prepareForParse();
      const userArgs = this._prepareUserArgs(argv, parseOptions);
      await this._parseCommand([], userArgs);
      return this;
    }
    _prepareForParse() {
      if (this._savedState === null) {
        this.saveStateBeforeParse();
      } else {
        this.restoreStateBeforeParse();
      }
    }
    saveStateBeforeParse() {
      this._savedState = {
        _name: this._name,
        _optionValues: { ...this._optionValues },
        _optionValueSources: { ...this._optionValueSources }
      };
    }
    restoreStateBeforeParse() {
      if (this._storeOptionsAsProperties)
        throw new Error(`Can not call parse again when storeOptionsAsProperties is true.
- either make a new Command for each call to parse, or stop storing options as properties`);
      this._name = this._savedState._name;
      this._scriptPath = null;
      this.rawArgs = [];
      this._optionValues = { ...this._savedState._optionValues };
      this._optionValueSources = { ...this._savedState._optionValueSources };
      this.args = [];
      this.processedArgs = [];
    }
    _checkForMissingExecutable(executableFile, executableDir, subcommandName) {
      if (fs.existsSync(executableFile))
        return;
      const executableDirMessage = executableDir ? `searched for local subcommand relative to directory '${executableDir}'` : "no directory for search for local subcommand, use .executableDir() to supply a custom directory";
      const executableMissing = `'${executableFile}' does not exist
 - if '${subcommandName}' is not meant to be an executable command, remove description parameter from '.command()' and use '.description()' instead
 - if the default executable name is not suitable, use the executableFile option to supply a custom name or path
 - ${executableDirMessage}`;
      throw new Error(executableMissing);
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
        } catch {
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
        this._checkForMissingExecutable(executableFile, executableDir, subcommand._name);
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
          this._checkForMissingExecutable(executableFile, executableDir, subcommand._name);
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
      subCommand._prepareForParse();
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
      const context = this._getOutputContext(contextOptions);
      helper.prepareContext({
        error: context.error,
        helpWidth: context.helpWidth,
        outputHasColors: context.hasColors
      });
      const text = helper.formatHelp(this, helper);
      if (context.hasColors)
        return text;
      return this._outputConfiguration.stripColor(text);
    }
    _getOutputContext(contextOptions) {
      contextOptions = contextOptions || {};
      const error = !!contextOptions.error;
      let baseWrite;
      let hasColors;
      let helpWidth;
      if (error) {
        baseWrite = (str) => this._outputConfiguration.writeErr(str);
        hasColors = this._outputConfiguration.getErrHasColors();
        helpWidth = this._outputConfiguration.getErrHelpWidth();
      } else {
        baseWrite = (str) => this._outputConfiguration.writeOut(str);
        hasColors = this._outputConfiguration.getOutHasColors();
        helpWidth = this._outputConfiguration.getOutHelpWidth();
      }
      const write = (str) => {
        if (!hasColors)
          str = this._outputConfiguration.stripColor(str);
        return baseWrite(str);
      };
      return { error, write, hasColors, helpWidth };
    }
    outputHelp(contextOptions) {
      let deprecatedCallback;
      if (typeof contextOptions === "function") {
        deprecatedCallback = contextOptions;
        contextOptions = undefined;
      }
      const outputContext = this._getOutputContext(contextOptions);
      const eventContext = {
        error: outputContext.error,
        write: outputContext.write,
        command: this
      };
      this._getCommandAndAncestors().reverse().forEach((command) => command.emit("beforeAllHelp", eventContext));
      this.emit("beforeHelp", eventContext);
      let helpInformation = this.helpInformation({ error: outputContext.error });
      if (deprecatedCallback) {
        helpInformation = deprecatedCallback(helpInformation);
        if (typeof helpInformation !== "string" && !Buffer.isBuffer(helpInformation)) {
          throw new Error("outputHelp callback must return a string or a Buffer");
        }
      }
      outputContext.write(helpInformation);
      if (this._getHelpOption()?.long) {
        this.emit(this._getHelpOption().long);
      }
      this.emit("afterHelp", eventContext);
      this._getCommandAndAncestors().forEach((command) => command.emit("afterAllHelp", eventContext));
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
      let exitCode = Number(process2.exitCode ?? 0);
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
  function useColor() {
    if (process2.env.NO_COLOR || process2.env.FORCE_COLOR === "0" || process2.env.FORCE_COLOR === "false")
      return false;
    if (process2.env.FORCE_COLOR || process2.env.CLICOLOR_FORCE !== undefined)
      return true;
    return;
  }
  exports.Command = Command;
  exports.useColor = useColor;
});

// ../../node_modules/.bun/commander@13.1.0/node_modules/commander/index.js
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

// ../../node_modules/.bun/postgres-array@2.0.0/node_modules/postgres-array/index.js
var require_postgres_array = __commonJS((exports) => {
  exports.parse = function(source, transform2) {
    return new ArrayParser(source, transform2).parse();
  };

  class ArrayParser {
    constructor(source, transform2) {
      this.source = source;
      this.transform = transform2 || identity;
      this.position = 0;
      this.entries = [];
      this.recorded = [];
      this.dimension = 0;
    }
    isEof() {
      return this.position >= this.source.length;
    }
    nextCharacter() {
      var character = this.source[this.position++];
      if (character === "\\") {
        return {
          value: this.source[this.position++],
          escaped: true
        };
      }
      return {
        value: character,
        escaped: false
      };
    }
    record(character) {
      this.recorded.push(character);
    }
    newEntry(includeEmpty) {
      var entry;
      if (this.recorded.length > 0 || includeEmpty) {
        entry = this.recorded.join("");
        if (entry === "NULL" && !includeEmpty) {
          entry = null;
        }
        if (entry !== null)
          entry = this.transform(entry);
        this.entries.push(entry);
        this.recorded = [];
      }
    }
    consumeDimensions() {
      if (this.source[0] === "[") {
        while (!this.isEof()) {
          var char = this.nextCharacter();
          if (char.value === "=")
            break;
        }
      }
    }
    parse(nested) {
      var character, parser, quote;
      this.consumeDimensions();
      while (!this.isEof()) {
        character = this.nextCharacter();
        if (character.value === "{" && !quote) {
          this.dimension++;
          if (this.dimension > 1) {
            parser = new ArrayParser(this.source.substr(this.position - 1), this.transform);
            this.entries.push(parser.parse(true));
            this.position += parser.position - 2;
          }
        } else if (character.value === "}" && !quote) {
          this.dimension--;
          if (!this.dimension) {
            this.newEntry();
            if (nested)
              return this.entries;
          }
        } else if (character.value === '"' && !character.escaped) {
          if (quote)
            this.newEntry(true);
          quote = !quote;
        } else if (character.value === "," && !quote) {
          this.newEntry();
        } else {
          this.record(character.value);
        }
      }
      if (this.dimension !== 0) {
        throw new Error("array dimension not balanced");
      }
      return this.entries;
    }
  }
  function identity(value) {
    return value;
  }
});

// ../../node_modules/.bun/pg-types@2.2.0/node_modules/pg-types/lib/arrayParser.js
var require_arrayParser = __commonJS((exports, module) => {
  var array2 = require_postgres_array();
  module.exports = {
    create: function(source, transform2) {
      return {
        parse: function() {
          return array2.parse(source, transform2);
        }
      };
    }
  };
});

// ../../node_modules/.bun/postgres-date@1.0.7/node_modules/postgres-date/index.js
var require_postgres_date = __commonJS((exports, module) => {
  var DATE_TIME = /(\d{1,})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(\.\d{1,})?.*?( BC)?$/;
  var DATE = /^(\d{1,})-(\d{2})-(\d{2})( BC)?$/;
  var TIME_ZONE = /([Z+-])(\d{2})?:?(\d{2})?:?(\d{2})?/;
  var INFINITY = /^-?infinity$/;
  module.exports = function parseDate(isoDate) {
    if (INFINITY.test(isoDate)) {
      return Number(isoDate.replace("i", "I"));
    }
    var matches = DATE_TIME.exec(isoDate);
    if (!matches) {
      return getDate(isoDate) || null;
    }
    var isBC = !!matches[8];
    var year = parseInt(matches[1], 10);
    if (isBC) {
      year = bcYearToNegativeYear(year);
    }
    var month = parseInt(matches[2], 10) - 1;
    var day = matches[3];
    var hour = parseInt(matches[4], 10);
    var minute = parseInt(matches[5], 10);
    var second = parseInt(matches[6], 10);
    var ms = matches[7];
    ms = ms ? 1000 * parseFloat(ms) : 0;
    var date3;
    var offset = timeZoneOffset(isoDate);
    if (offset != null) {
      date3 = new Date(Date.UTC(year, month, day, hour, minute, second, ms));
      if (is0To99(year)) {
        date3.setUTCFullYear(year);
      }
      if (offset !== 0) {
        date3.setTime(date3.getTime() - offset);
      }
    } else {
      date3 = new Date(year, month, day, hour, minute, second, ms);
      if (is0To99(year)) {
        date3.setFullYear(year);
      }
    }
    return date3;
  };
  function getDate(isoDate) {
    var matches = DATE.exec(isoDate);
    if (!matches) {
      return;
    }
    var year = parseInt(matches[1], 10);
    var isBC = !!matches[4];
    if (isBC) {
      year = bcYearToNegativeYear(year);
    }
    var month = parseInt(matches[2], 10) - 1;
    var day = matches[3];
    var date3 = new Date(year, month, day);
    if (is0To99(year)) {
      date3.setFullYear(year);
    }
    return date3;
  }
  function timeZoneOffset(isoDate) {
    if (isoDate.endsWith("+00")) {
      return 0;
    }
    var zone = TIME_ZONE.exec(isoDate.split(" ")[1]);
    if (!zone)
      return;
    var type = zone[1];
    if (type === "Z") {
      return 0;
    }
    var sign = type === "-" ? -1 : 1;
    var offset = parseInt(zone[2], 10) * 3600 + parseInt(zone[3] || 0, 10) * 60 + parseInt(zone[4] || 0, 10);
    return offset * sign * 1000;
  }
  function bcYearToNegativeYear(year) {
    return -(year - 1);
  }
  function is0To99(num) {
    return num >= 0 && num < 100;
  }
});

// ../../node_modules/.bun/xtend@4.0.2/node_modules/xtend/mutable.js
var require_mutable = __commonJS((exports, module) => {
  module.exports = extend2;
  var hasOwnProperty = Object.prototype.hasOwnProperty;
  function extend2(target) {
    for (var i = 1;i < arguments.length; i++) {
      var source = arguments[i];
      for (var key in source) {
        if (hasOwnProperty.call(source, key)) {
          target[key] = source[key];
        }
      }
    }
    return target;
  }
});

// ../../node_modules/.bun/postgres-interval@1.2.0/node_modules/postgres-interval/index.js
var require_postgres_interval = __commonJS((exports, module) => {
  var extend2 = require_mutable();
  module.exports = PostgresInterval;
  function PostgresInterval(raw) {
    if (!(this instanceof PostgresInterval)) {
      return new PostgresInterval(raw);
    }
    extend2(this, parse4(raw));
  }
  var properties = ["seconds", "minutes", "hours", "days", "months", "years"];
  PostgresInterval.prototype.toPostgres = function() {
    var filtered = properties.filter(this.hasOwnProperty, this);
    if (this.milliseconds && filtered.indexOf("seconds") < 0) {
      filtered.push("seconds");
    }
    if (filtered.length === 0)
      return "0";
    return filtered.map(function(property) {
      var value = this[property] || 0;
      if (property === "seconds" && this.milliseconds) {
        value = (value + this.milliseconds / 1000).toFixed(6).replace(/\.?0+$/, "");
      }
      return value + " " + property;
    }, this).join(" ");
  };
  var propertiesISOEquivalent = {
    years: "Y",
    months: "M",
    days: "D",
    hours: "H",
    minutes: "M",
    seconds: "S"
  };
  var dateProperties = ["years", "months", "days"];
  var timeProperties = ["hours", "minutes", "seconds"];
  PostgresInterval.prototype.toISOString = PostgresInterval.prototype.toISO = function() {
    var datePart = dateProperties.map(buildProperty, this).join("");
    var timePart = timeProperties.map(buildProperty, this).join("");
    return "P" + datePart + "T" + timePart;
    function buildProperty(property) {
      var value = this[property] || 0;
      if (property === "seconds" && this.milliseconds) {
        value = (value + this.milliseconds / 1000).toFixed(6).replace(/0+$/, "");
      }
      return value + propertiesISOEquivalent[property];
    }
  };
  var NUMBER = "([+-]?\\d+)";
  var YEAR = NUMBER + "\\s+years?";
  var MONTH = NUMBER + "\\s+mons?";
  var DAY = NUMBER + "\\s+days?";
  var TIME = "([+-])?([\\d]*):(\\d\\d):(\\d\\d)\\.?(\\d{1,6})?";
  var INTERVAL = new RegExp([YEAR, MONTH, DAY, TIME].map(function(regexString) {
    return "(" + regexString + ")?";
  }).join("\\s*"));
  var positions = {
    years: 2,
    months: 4,
    days: 6,
    hours: 9,
    minutes: 10,
    seconds: 11,
    milliseconds: 12
  };
  var negatives = ["hours", "minutes", "seconds", "milliseconds"];
  function parseMilliseconds(fraction) {
    var microseconds = fraction + "000000".slice(fraction.length);
    return parseInt(microseconds, 10) / 1000;
  }
  function parse4(interval) {
    if (!interval)
      return {};
    var matches = INTERVAL.exec(interval);
    var isNegative = matches[8] === "-";
    return Object.keys(positions).reduce(function(parsed, property) {
      var position = positions[property];
      var value = matches[position];
      if (!value)
        return parsed;
      value = property === "milliseconds" ? parseMilliseconds(value) : parseInt(value, 10);
      if (!value)
        return parsed;
      if (isNegative && ~negatives.indexOf(property)) {
        value *= -1;
      }
      parsed[property] = value;
      return parsed;
    }, {});
  }
});

// ../../node_modules/.bun/postgres-bytea@1.0.1/node_modules/postgres-bytea/index.js
var require_postgres_bytea = __commonJS((exports, module) => {
  var bufferFrom = Buffer.from || Buffer;
  module.exports = function parseBytea(input) {
    if (/^\\x/.test(input)) {
      return bufferFrom(input.substr(2), "hex");
    }
    var output = "";
    var i = 0;
    while (i < input.length) {
      if (input[i] !== "\\") {
        output += input[i];
        ++i;
      } else {
        if (/[0-7]{3}/.test(input.substr(i + 1, 3))) {
          output += String.fromCharCode(parseInt(input.substr(i + 1, 3), 8));
          i += 4;
        } else {
          var backslashes = 1;
          while (i + backslashes < input.length && input[i + backslashes] === "\\") {
            backslashes++;
          }
          for (var k = 0;k < Math.floor(backslashes / 2); ++k) {
            output += "\\";
          }
          i += Math.floor(backslashes / 2) * 2;
        }
      }
    }
    return bufferFrom(output, "binary");
  };
});

// ../../node_modules/.bun/pg-types@2.2.0/node_modules/pg-types/lib/textParsers.js
var require_textParsers = __commonJS((exports, module) => {
  var array2 = require_postgres_array();
  var arrayParser = require_arrayParser();
  var parseDate = require_postgres_date();
  var parseInterval = require_postgres_interval();
  var parseByteA = require_postgres_bytea();
  function allowNull(fn) {
    return function nullAllowed(value) {
      if (value === null)
        return value;
      return fn(value);
    };
  }
  function parseBool(value) {
    if (value === null)
      return value;
    return value === "TRUE" || value === "t" || value === "true" || value === "y" || value === "yes" || value === "on" || value === "1";
  }
  function parseBoolArray(value) {
    if (!value)
      return null;
    return array2.parse(value, parseBool);
  }
  function parseBaseTenInt(string3) {
    return parseInt(string3, 10);
  }
  function parseIntegerArray(value) {
    if (!value)
      return null;
    return array2.parse(value, allowNull(parseBaseTenInt));
  }
  function parseBigIntegerArray(value) {
    if (!value)
      return null;
    return array2.parse(value, allowNull(function(entry) {
      return parseBigInteger(entry).trim();
    }));
  }
  var parsePointArray = function(value) {
    if (!value) {
      return null;
    }
    var p = arrayParser.create(value, function(entry) {
      if (entry !== null) {
        entry = parsePoint(entry);
      }
      return entry;
    });
    return p.parse();
  };
  var parseFloatArray = function(value) {
    if (!value) {
      return null;
    }
    var p = arrayParser.create(value, function(entry) {
      if (entry !== null) {
        entry = parseFloat(entry);
      }
      return entry;
    });
    return p.parse();
  };
  var parseStringArray = function(value) {
    if (!value) {
      return null;
    }
    var p = arrayParser.create(value);
    return p.parse();
  };
  var parseDateArray = function(value) {
    if (!value) {
      return null;
    }
    var p = arrayParser.create(value, function(entry) {
      if (entry !== null) {
        entry = parseDate(entry);
      }
      return entry;
    });
    return p.parse();
  };
  var parseIntervalArray = function(value) {
    if (!value) {
      return null;
    }
    var p = arrayParser.create(value, function(entry) {
      if (entry !== null) {
        entry = parseInterval(entry);
      }
      return entry;
    });
    return p.parse();
  };
  var parseByteAArray = function(value) {
    if (!value) {
      return null;
    }
    return array2.parse(value, allowNull(parseByteA));
  };
  var parseInteger = function(value) {
    return parseInt(value, 10);
  };
  var parseBigInteger = function(value) {
    var valStr = String(value);
    if (/^\d+$/.test(valStr)) {
      return valStr;
    }
    return value;
  };
  var parseJsonArray = function(value) {
    if (!value) {
      return null;
    }
    return array2.parse(value, allowNull(JSON.parse));
  };
  var parsePoint = function(value) {
    if (value[0] !== "(") {
      return null;
    }
    value = value.substring(1, value.length - 1).split(",");
    return {
      x: parseFloat(value[0]),
      y: parseFloat(value[1])
    };
  };
  var parseCircle = function(value) {
    if (value[0] !== "<" && value[1] !== "(") {
      return null;
    }
    var point = "(";
    var radius = "";
    var pointParsed = false;
    for (var i = 2;i < value.length - 1; i++) {
      if (!pointParsed) {
        point += value[i];
      }
      if (value[i] === ")") {
        pointParsed = true;
        continue;
      } else if (!pointParsed) {
        continue;
      }
      if (value[i] === ",") {
        continue;
      }
      radius += value[i];
    }
    var result = parsePoint(point);
    result.radius = parseFloat(radius);
    return result;
  };
  var init = function(register) {
    register(20, parseBigInteger);
    register(21, parseInteger);
    register(23, parseInteger);
    register(26, parseInteger);
    register(700, parseFloat);
    register(701, parseFloat);
    register(16, parseBool);
    register(1082, parseDate);
    register(1114, parseDate);
    register(1184, parseDate);
    register(600, parsePoint);
    register(651, parseStringArray);
    register(718, parseCircle);
    register(1000, parseBoolArray);
    register(1001, parseByteAArray);
    register(1005, parseIntegerArray);
    register(1007, parseIntegerArray);
    register(1028, parseIntegerArray);
    register(1016, parseBigIntegerArray);
    register(1017, parsePointArray);
    register(1021, parseFloatArray);
    register(1022, parseFloatArray);
    register(1231, parseFloatArray);
    register(1014, parseStringArray);
    register(1015, parseStringArray);
    register(1008, parseStringArray);
    register(1009, parseStringArray);
    register(1040, parseStringArray);
    register(1041, parseStringArray);
    register(1115, parseDateArray);
    register(1182, parseDateArray);
    register(1185, parseDateArray);
    register(1186, parseInterval);
    register(1187, parseIntervalArray);
    register(17, parseByteA);
    register(114, JSON.parse.bind(JSON));
    register(3802, JSON.parse.bind(JSON));
    register(199, parseJsonArray);
    register(3807, parseJsonArray);
    register(3907, parseStringArray);
    register(2951, parseStringArray);
    register(791, parseStringArray);
    register(1183, parseStringArray);
    register(1270, parseStringArray);
  };
  module.exports = {
    init
  };
});

// ../../node_modules/.bun/pg-int8@1.0.1/node_modules/pg-int8/index.js
var require_pg_int8 = __commonJS((exports, module) => {
  var BASE = 1e6;
  function readInt8(buffer) {
    var high = buffer.readInt32BE(0);
    var low = buffer.readUInt32BE(4);
    var sign = "";
    if (high < 0) {
      high = ~high + (low === 0);
      low = ~low + 1 >>> 0;
      sign = "-";
    }
    var result = "";
    var carry;
    var t;
    var digits;
    var pad;
    var l;
    var i;
    {
      carry = high % BASE;
      high = high / BASE >>> 0;
      t = 4294967296 * carry + low;
      low = t / BASE >>> 0;
      digits = "" + (t - BASE * low);
      if (low === 0 && high === 0) {
        return sign + digits + result;
      }
      pad = "";
      l = 6 - digits.length;
      for (i = 0;i < l; i++) {
        pad += "0";
      }
      result = pad + digits + result;
    }
    {
      carry = high % BASE;
      high = high / BASE >>> 0;
      t = 4294967296 * carry + low;
      low = t / BASE >>> 0;
      digits = "" + (t - BASE * low);
      if (low === 0 && high === 0) {
        return sign + digits + result;
      }
      pad = "";
      l = 6 - digits.length;
      for (i = 0;i < l; i++) {
        pad += "0";
      }
      result = pad + digits + result;
    }
    {
      carry = high % BASE;
      high = high / BASE >>> 0;
      t = 4294967296 * carry + low;
      low = t / BASE >>> 0;
      digits = "" + (t - BASE * low);
      if (low === 0 && high === 0) {
        return sign + digits + result;
      }
      pad = "";
      l = 6 - digits.length;
      for (i = 0;i < l; i++) {
        pad += "0";
      }
      result = pad + digits + result;
    }
    {
      carry = high % BASE;
      t = 4294967296 * carry + low;
      digits = "" + t % BASE;
      return sign + digits + result;
    }
  }
  module.exports = readInt8;
});

// ../../node_modules/.bun/pg-types@2.2.0/node_modules/pg-types/lib/binaryParsers.js
var require_binaryParsers = __commonJS((exports, module) => {
  var parseInt64 = require_pg_int8();
  var parseBits = function(data, bits, offset, invert, callback) {
    offset = offset || 0;
    invert = invert || false;
    callback = callback || function(lastValue, newValue, bits2) {
      return lastValue * Math.pow(2, bits2) + newValue;
    };
    var offsetBytes = offset >> 3;
    var inv = function(value) {
      if (invert) {
        return ~value & 255;
      }
      return value;
    };
    var mask = 255;
    var firstBits = 8 - offset % 8;
    if (bits < firstBits) {
      mask = 255 << 8 - bits & 255;
      firstBits = bits;
    }
    if (offset) {
      mask = mask >> offset % 8;
    }
    var result = 0;
    if (offset % 8 + bits >= 8) {
      result = callback(0, inv(data[offsetBytes]) & mask, firstBits);
    }
    var bytes = bits + offset >> 3;
    for (var i = offsetBytes + 1;i < bytes; i++) {
      result = callback(result, inv(data[i]), 8);
    }
    var lastBits = (bits + offset) % 8;
    if (lastBits > 0) {
      result = callback(result, inv(data[bytes]) >> 8 - lastBits, lastBits);
    }
    return result;
  };
  var parseFloatFromBits = function(data, precisionBits, exponentBits) {
    var bias = Math.pow(2, exponentBits - 1) - 1;
    var sign = parseBits(data, 1);
    var exponent = parseBits(data, exponentBits, 1);
    if (exponent === 0) {
      return 0;
    }
    var precisionBitsCounter = 1;
    var parsePrecisionBits = function(lastValue, newValue, bits) {
      if (lastValue === 0) {
        lastValue = 1;
      }
      for (var i = 1;i <= bits; i++) {
        precisionBitsCounter /= 2;
        if ((newValue & 1 << bits - i) > 0) {
          lastValue += precisionBitsCounter;
        }
      }
      return lastValue;
    };
    var mantissa = parseBits(data, precisionBits, exponentBits + 1, false, parsePrecisionBits);
    if (exponent == Math.pow(2, exponentBits + 1) - 1) {
      if (mantissa === 0) {
        return sign === 0 ? Infinity : -Infinity;
      }
      return NaN;
    }
    return (sign === 0 ? 1 : -1) * Math.pow(2, exponent - bias) * mantissa;
  };
  var parseInt16 = function(value) {
    if (parseBits(value, 1) == 1) {
      return -1 * (parseBits(value, 15, 1, true) + 1);
    }
    return parseBits(value, 15, 1);
  };
  var parseInt32 = function(value) {
    if (parseBits(value, 1) == 1) {
      return -1 * (parseBits(value, 31, 1, true) + 1);
    }
    return parseBits(value, 31, 1);
  };
  var parseFloat32 = function(value) {
    return parseFloatFromBits(value, 23, 8);
  };
  var parseFloat64 = function(value) {
    return parseFloatFromBits(value, 52, 11);
  };
  var parseNumeric = function(value) {
    var sign = parseBits(value, 16, 32);
    if (sign == 49152) {
      return NaN;
    }
    var weight = Math.pow(1e4, parseBits(value, 16, 16));
    var result = 0;
    var digits = [];
    var ndigits = parseBits(value, 16);
    for (var i = 0;i < ndigits; i++) {
      result += parseBits(value, 16, 64 + 16 * i) * weight;
      weight /= 1e4;
    }
    var scale = Math.pow(10, parseBits(value, 16, 48));
    return (sign === 0 ? 1 : -1) * Math.round(result * scale) / scale;
  };
  var parseDate = function(isUTC, value) {
    var sign = parseBits(value, 1);
    var rawValue = parseBits(value, 63, 1);
    var result = new Date((sign === 0 ? 1 : -1) * rawValue / 1000 + 946684800000);
    if (!isUTC) {
      result.setTime(result.getTime() + result.getTimezoneOffset() * 60000);
    }
    result.usec = rawValue % 1000;
    result.getMicroSeconds = function() {
      return this.usec;
    };
    result.setMicroSeconds = function(value2) {
      this.usec = value2;
    };
    result.getUTCMicroSeconds = function() {
      return this.usec;
    };
    return result;
  };
  var parseArray = function(value) {
    var dim = parseBits(value, 32);
    var flags = parseBits(value, 32, 32);
    var elementType = parseBits(value, 32, 64);
    var offset = 96;
    var dims = [];
    for (var i = 0;i < dim; i++) {
      dims[i] = parseBits(value, 32, offset);
      offset += 32;
      offset += 32;
    }
    var parseElement = function(elementType2) {
      var length = parseBits(value, 32, offset);
      offset += 32;
      if (length == 4294967295) {
        return null;
      }
      var result;
      if (elementType2 == 23 || elementType2 == 20) {
        result = parseBits(value, length * 8, offset);
        offset += length * 8;
        return result;
      } else if (elementType2 == 25) {
        result = value.toString(this.encoding, offset >> 3, (offset += length << 3) >> 3);
        return result;
      } else {
        console.log("ERROR: ElementType not implemented: " + elementType2);
      }
    };
    var parse4 = function(dimension, elementType2) {
      var array2 = [];
      var i2;
      if (dimension.length > 1) {
        var count = dimension.shift();
        for (i2 = 0;i2 < count; i2++) {
          array2[i2] = parse4(dimension, elementType2);
        }
        dimension.unshift(count);
      } else {
        for (i2 = 0;i2 < dimension[0]; i2++) {
          array2[i2] = parseElement(elementType2);
        }
      }
      return array2;
    };
    return parse4(dims, elementType);
  };
  var parseText = function(value) {
    return value.toString("utf8");
  };
  var parseBool = function(value) {
    if (value === null)
      return null;
    return parseBits(value, 8) > 0;
  };
  var init = function(register) {
    register(20, parseInt64);
    register(21, parseInt16);
    register(23, parseInt32);
    register(26, parseInt32);
    register(1700, parseNumeric);
    register(700, parseFloat32);
    register(701, parseFloat64);
    register(16, parseBool);
    register(1114, parseDate.bind(null, false));
    register(1184, parseDate.bind(null, true));
    register(1000, parseArray);
    register(1007, parseArray);
    register(1016, parseArray);
    register(1008, parseArray);
    register(1009, parseArray);
    register(25, parseText);
  };
  module.exports = {
    init
  };
});

// ../../node_modules/.bun/pg-types@2.2.0/node_modules/pg-types/lib/builtins.js
var require_builtins = __commonJS((exports, module) => {
  module.exports = {
    BOOL: 16,
    BYTEA: 17,
    CHAR: 18,
    INT8: 20,
    INT2: 21,
    INT4: 23,
    REGPROC: 24,
    TEXT: 25,
    OID: 26,
    TID: 27,
    XID: 28,
    CID: 29,
    JSON: 114,
    XML: 142,
    PG_NODE_TREE: 194,
    SMGR: 210,
    PATH: 602,
    POLYGON: 604,
    CIDR: 650,
    FLOAT4: 700,
    FLOAT8: 701,
    ABSTIME: 702,
    RELTIME: 703,
    TINTERVAL: 704,
    CIRCLE: 718,
    MACADDR8: 774,
    MONEY: 790,
    MACADDR: 829,
    INET: 869,
    ACLITEM: 1033,
    BPCHAR: 1042,
    VARCHAR: 1043,
    DATE: 1082,
    TIME: 1083,
    TIMESTAMP: 1114,
    TIMESTAMPTZ: 1184,
    INTERVAL: 1186,
    TIMETZ: 1266,
    BIT: 1560,
    VARBIT: 1562,
    NUMERIC: 1700,
    REFCURSOR: 1790,
    REGPROCEDURE: 2202,
    REGOPER: 2203,
    REGOPERATOR: 2204,
    REGCLASS: 2205,
    REGTYPE: 2206,
    UUID: 2950,
    TXID_SNAPSHOT: 2970,
    PG_LSN: 3220,
    PG_NDISTINCT: 3361,
    PG_DEPENDENCIES: 3402,
    TSVECTOR: 3614,
    TSQUERY: 3615,
    GTSVECTOR: 3642,
    REGCONFIG: 3734,
    REGDICTIONARY: 3769,
    JSONB: 3802,
    REGNAMESPACE: 4089,
    REGROLE: 4096
  };
});

// ../../node_modules/.bun/pg-types@2.2.0/node_modules/pg-types/index.js
var require_pg_types = __commonJS((exports) => {
  var textParsers = require_textParsers();
  var binaryParsers = require_binaryParsers();
  var arrayParser = require_arrayParser();
  var builtinTypes = require_builtins();
  exports.getTypeParser = getTypeParser;
  exports.setTypeParser = setTypeParser;
  exports.arrayParser = arrayParser;
  exports.builtins = builtinTypes;
  var typeParsers = {
    text: {},
    binary: {}
  };
  function noParse(val) {
    return String(val);
  }
  function getTypeParser(oid, format) {
    format = format || "text";
    if (!typeParsers[format]) {
      return noParse;
    }
    return typeParsers[format][oid] || noParse;
  }
  function setTypeParser(oid, format, parseFn) {
    if (typeof format == "function") {
      parseFn = format;
      format = "text";
    }
    typeParsers[format][oid] = parseFn;
  }
  textParsers.init(function(oid, converter) {
    typeParsers.text[oid] = converter;
  });
  binaryParsers.init(function(oid, converter) {
    typeParsers.binary[oid] = converter;
  });
});

// ../../node_modules/.bun/pg@8.23.0+00a0136bc273dfed/node_modules/pg/lib/defaults.js
var require_defaults = __commonJS((exports, module) => {
  var user;
  try {
    user = process.platform === "win32" ? process.env.USERNAME : process.env.USER;
  } catch {}
  module.exports = {
    host: "localhost",
    user,
    database: undefined,
    password: null,
    connectionString: undefined,
    port: 5432,
    rows: 0,
    binary: false,
    max: 10,
    idleTimeoutMillis: 30000,
    client_encoding: "",
    ssl: false,
    sslnegotiation: undefined,
    application_name: undefined,
    fallback_application_name: undefined,
    options: undefined,
    parseInputDatesAsUTC: false,
    statement_timeout: false,
    lock_timeout: false,
    idle_in_transaction_session_timeout: false,
    query_timeout: false,
    connect_timeout: 0,
    keepalives: 1,
    keepalives_idle: 0
  };
  var pgTypes = require_pg_types();
  var parseBigInteger = pgTypes.getTypeParser(20, "text");
  var parseBigIntegerArray = pgTypes.getTypeParser(1016, "text");
  module.exports.__defineSetter__("parseInt8", function(val) {
    pgTypes.setTypeParser(20, "text", val ? pgTypes.getTypeParser(23, "text") : parseBigInteger);
    pgTypes.setTypeParser(1016, "text", val ? pgTypes.getTypeParser(1007, "text") : parseBigIntegerArray);
  });
});

// ../../node_modules/.bun/pg@8.23.0+00a0136bc273dfed/node_modules/pg/lib/utils.js
var require_utils = __commonJS((exports, module) => {
  var defaults = require_defaults();
  var { isDate } = __require("util/types");
  function escapeElement(elementRepresentation) {
    const escaped = elementRepresentation.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
    return '"' + escaped + '"';
  }
  function arrayString(val) {
    let result = "{";
    for (let i = 0;i < val.length; i++) {
      if (i > 0) {
        result += ",";
      }
      let item = val[i];
      if (item == null) {
        result += "NULL";
      } else if (Array.isArray(item)) {
        result += arrayString(item);
      } else if (ArrayBuffer.isView(item)) {
        if (!(item instanceof Buffer)) {
          item = Buffer.from(item.buffer, item.byteOffset, item.byteLength);
        }
        result += "\\\\x" + item.toString("hex");
      } else {
        result += escapeElement(prepareValue(item));
      }
    }
    result += "}";
    return result;
  }
  var prepareValue = function(val, seen) {
    if (val == null) {
      return null;
    }
    if (typeof val === "object") {
      if (val instanceof Buffer) {
        return val;
      }
      if (ArrayBuffer.isView(val)) {
        return Buffer.from(val.buffer, val.byteOffset, val.byteLength);
      }
      if (isDate(val)) {
        if (defaults.parseInputDatesAsUTC) {
          return dateToStringUTC(val);
        } else {
          return dateToString(val);
        }
      }
      if (Array.isArray(val)) {
        return arrayString(val);
      }
      return prepareObject(val, seen);
    }
    return val.toString();
  };
  function prepareObject(val, seen) {
    if (val && typeof val.toPostgres === "function") {
      seen = seen || [];
      if (seen.indexOf(val) !== -1) {
        throw new Error('circular reference detected while preparing "' + val + '" for query');
      }
      seen.push(val);
      return prepareValue(val.toPostgres(prepareValue), seen);
    }
    return JSON.stringify(val);
  }
  function dateToString(date3) {
    let offset = -date3.getTimezoneOffset();
    let year = date3.getFullYear();
    const isBCYear = year < 1;
    if (isBCYear)
      year = Math.abs(year) + 1;
    let ret = String(year).padStart(4, "0") + "-" + String(date3.getMonth() + 1).padStart(2, "0") + "-" + String(date3.getDate()).padStart(2, "0") + "T" + String(date3.getHours()).padStart(2, "0") + ":" + String(date3.getMinutes()).padStart(2, "0") + ":" + String(date3.getSeconds()).padStart(2, "0") + "." + String(date3.getMilliseconds()).padStart(3, "0");
    if (offset < 0) {
      ret += "-";
      offset *= -1;
    } else {
      ret += "+";
    }
    ret += String(Math.floor(offset / 60)).padStart(2, "0") + ":" + String(offset % 60).padStart(2, "0");
    if (isBCYear)
      ret += " BC";
    return ret;
  }
  function dateToStringUTC(date3) {
    let year = date3.getUTCFullYear();
    const isBCYear = year < 1;
    if (isBCYear)
      year = Math.abs(year) + 1;
    let ret = String(year).padStart(4, "0") + "-" + String(date3.getUTCMonth() + 1).padStart(2, "0") + "-" + String(date3.getUTCDate()).padStart(2, "0") + "T" + String(date3.getUTCHours()).padStart(2, "0") + ":" + String(date3.getUTCMinutes()).padStart(2, "0") + ":" + String(date3.getUTCSeconds()).padStart(2, "0") + "." + String(date3.getUTCMilliseconds()).padStart(3, "0");
    ret += "+00:00";
    if (isBCYear)
      ret += " BC";
    return ret;
  }
  function normalizeQueryConfig(config2, values, callback) {
    config2 = typeof config2 === "string" ? { text: config2 } : config2;
    if (values) {
      if (typeof values === "function") {
        config2.callback = values;
      } else {
        config2.values = values;
      }
    }
    if (callback) {
      config2.callback = callback;
    }
    return config2;
  }
  var escapeIdentifier = function(str) {
    return '"' + str.replace(/"/g, '""') + '"';
  };
  var escapeLiteral = function(str) {
    let hasBackslash = false;
    let escaped = "'";
    if (str == null) {
      return "''";
    }
    if (typeof str !== "string") {
      return "''";
    }
    for (let i = 0;i < str.length; i++) {
      const c = str[i];
      if (c === "'") {
        escaped += c + c;
      } else if (c === "\\") {
        escaped += c + c;
        hasBackslash = true;
      } else {
        escaped += c;
      }
    }
    escaped += "'";
    if (hasBackslash === true) {
      escaped = " E" + escaped;
    }
    return escaped;
  };
  module.exports = {
    prepareValue: function prepareValueWrapper(value) {
      return prepareValue(value);
    },
    normalizeQueryConfig,
    escapeIdentifier,
    escapeLiteral
  };
});

// ../../node_modules/.bun/pg@8.23.0+00a0136bc273dfed/node_modules/pg/lib/crypto/utils.js
var require_utils2 = __commonJS((exports, module) => {
  var nodeCrypto = __require("crypto");
  module.exports = {
    postgresMd5PasswordHash,
    randomBytes: randomBytes2,
    deriveKey,
    sha256: sha2562,
    hashByName,
    hmacSha256,
    md5
  };
  var webCrypto = nodeCrypto.webcrypto || globalThis.crypto;
  var subtleCrypto = webCrypto.subtle;
  var textEncoder = new TextEncoder;
  function randomBytes2(length) {
    return webCrypto.getRandomValues(Buffer.alloc(length));
  }
  async function md5(string3) {
    try {
      return nodeCrypto.createHash("md5").update(string3, "utf-8").digest("hex");
    } catch (e) {
      const data = typeof string3 === "string" ? textEncoder.encode(string3) : string3;
      const hash = await subtleCrypto.digest("MD5", data);
      return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
  }
  async function postgresMd5PasswordHash(user, password, salt) {
    const inner = await md5(password + user);
    const outer = await md5(Buffer.concat([Buffer.from(inner), salt]));
    return "md5" + outer;
  }
  async function sha2562(text) {
    return await subtleCrypto.digest("SHA-256", text);
  }
  async function hashByName(hashName, text) {
    return await subtleCrypto.digest(hashName, text);
  }
  async function hmacSha256(keyBuffer, msg) {
    const key = await subtleCrypto.importKey("raw", keyBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return await subtleCrypto.sign("HMAC", key, textEncoder.encode(msg));
  }
  async function deriveKey(password, salt, iterations) {
    const key = await subtleCrypto.importKey("raw", textEncoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const params = { name: "PBKDF2", hash: "SHA-256", salt, iterations };
    return await subtleCrypto.deriveBits(params, key, 32 * 8, ["deriveBits"]);
  }
});

// ../../node_modules/.bun/pg@8.23.0+00a0136bc273dfed/node_modules/pg/lib/crypto/cert-signatures.js
var require_cert_signatures = __commonJS((exports, module) => {
  function x509Error(msg, cert) {
    return new Error("SASL channel binding: " + msg + " when parsing public certificate " + cert.toString("base64"));
  }
  function readASN1Length(data, index) {
    let length = data[index++];
    if (length < 128)
      return { length, index };
    const lengthBytes = length & 127;
    if (lengthBytes > 4)
      throw x509Error("bad length", data);
    length = 0;
    for (let i = 0;i < lengthBytes; i++) {
      length = length << 8 | data[index++];
    }
    return { length, index };
  }
  function readASN1OID(data, index) {
    if (data[index++] !== 6)
      throw x509Error("non-OID data", data);
    const { length: OIDLength, index: indexAfterOIDLength } = readASN1Length(data, index);
    index = indexAfterOIDLength;
    const lastIndex = index + OIDLength;
    const byte1 = data[index++];
    let oid = (byte1 / 40 >> 0) + "." + byte1 % 40;
    while (index < lastIndex) {
      let value = 0;
      while (index < lastIndex) {
        const nextByte = data[index++];
        value = value << 7 | nextByte & 127;
        if (nextByte < 128)
          break;
      }
      oid += "." + value;
    }
    return { oid, index };
  }
  function expectASN1Seq(data, index) {
    if (data[index++] !== 48)
      throw x509Error("non-sequence data", data);
    return readASN1Length(data, index);
  }
  function signatureAlgorithmHashFromCertificate(data, index) {
    if (index === undefined)
      index = 0;
    index = expectASN1Seq(data, index).index;
    const { length: certInfoLength, index: indexAfterCertInfoLength } = expectASN1Seq(data, index);
    index = indexAfterCertInfoLength + certInfoLength;
    index = expectASN1Seq(data, index).index;
    const { oid, index: indexAfterOID } = readASN1OID(data, index);
    switch (oid) {
      case "1.2.840.113549.1.1.4":
        return "MD5";
      case "1.2.840.113549.1.1.5":
        return "SHA-1";
      case "1.2.840.113549.1.1.11":
        return "SHA-256";
      case "1.2.840.113549.1.1.12":
        return "SHA-384";
      case "1.2.840.113549.1.1.13":
        return "SHA-512";
      case "1.2.840.113549.1.1.14":
        return "SHA-224";
      case "1.2.840.113549.1.1.15":
        return "SHA512-224";
      case "1.2.840.113549.1.1.16":
        return "SHA512-256";
      case "1.2.840.10045.4.1":
        return "SHA-1";
      case "1.2.840.10045.4.3.1":
        return "SHA-224";
      case "1.2.840.10045.4.3.2":
        return "SHA-256";
      case "1.2.840.10045.4.3.3":
        return "SHA-384";
      case "1.2.840.10045.4.3.4":
        return "SHA-512";
      case "1.2.840.113549.1.1.10": {
        index = indexAfterOID;
        index = expectASN1Seq(data, index).index;
        if (data[index++] !== 160)
          throw x509Error("non-tag data", data);
        index = readASN1Length(data, index).index;
        index = expectASN1Seq(data, index).index;
        const { oid: hashOID } = readASN1OID(data, index);
        switch (hashOID) {
          case "1.2.840.113549.2.5":
            return "MD5";
          case "1.3.14.3.2.26":
            return "SHA-1";
          case "2.16.840.1.101.3.4.2.1":
            return "SHA-256";
          case "2.16.840.1.101.3.4.2.2":
            return "SHA-384";
          case "2.16.840.1.101.3.4.2.3":
            return "SHA-512";
        }
        throw x509Error("unknown hash OID " + hashOID, data);
      }
      case "1.3.101.110":
      case "1.3.101.112":
        return "SHA-512";
      case "1.3.101.111":
      case "1.3.101.113":
        throw x509Error("Ed448 certificate channel binding is not currently supported by Postgres");
    }
    throw x509Error("unknown OID " + oid, data);
  }
  module.exports = { signatureAlgorithmHashFromCertificate };
});

// ../../node_modules/.bun/pg@8.23.0+00a0136bc273dfed/node_modules/pg/lib/crypto/sasl.js
var require_sasl = __commonJS((exports, module) => {
  var crypto = require_utils2();
  var { signatureAlgorithmHashFromCertificate } = require_cert_signatures();
  function saslprep(password) {
    const nonAsciiSpace = /[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000]/g;
    const mappedToNothing = /[\u00AD\u034F\u1806\u180B\u180C\u180D\u200C\u200D\u2060\uFE00-\uFE0F\uFEFF]/g;
    return password.replace(nonAsciiSpace, " ").replace(mappedToNothing, "").normalize("NFKC");
  }
  var DEFAULT_MAX_SCRAM_ITERATIONS = 1e5;
  function startSession(mechanisms, stream, scramMaxIterations = DEFAULT_MAX_SCRAM_ITERATIONS) {
    const candidates = ["SCRAM-SHA-256"];
    if (stream)
      candidates.unshift("SCRAM-SHA-256-PLUS");
    const mechanism = candidates.find((candidate) => mechanisms.includes(candidate));
    if (!mechanism) {
      throw new Error("SASL: Only mechanism(s) " + candidates.join(" and ") + " are supported");
    }
    if (mechanism === "SCRAM-SHA-256-PLUS" && typeof stream.getPeerCertificate !== "function") {
      throw new Error("SASL: Mechanism SCRAM-SHA-256-PLUS requires a certificate");
    }
    const clientNonce = crypto.randomBytes(18).toString("base64");
    const gs2Header = mechanism === "SCRAM-SHA-256-PLUS" ? "p=tls-server-end-point" : stream ? "y" : "n";
    return {
      mechanism,
      clientNonce,
      response: gs2Header + ",,n=*,r=" + clientNonce,
      message: "SASLInitialResponse",
      scramMaxIterations
    };
  }
  async function continueSession(session, password, serverData, stream) {
    if (session.message !== "SASLInitialResponse") {
      throw new Error("SASL: Last message was not SASLInitialResponse");
    }
    if (typeof password !== "string") {
      throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string");
    }
    if (password === "") {
      throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a non-empty string");
    }
    if (typeof serverData !== "string") {
      throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: serverData must be a string");
    }
    const sv = parseServerFirstMessage(serverData);
    if (!sv.nonce.startsWith(session.clientNonce)) {
      throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: server nonce does not start with client nonce");
    } else if (sv.nonce.length === session.clientNonce.length) {
      throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: server nonce is too short");
    }
    const scramMaxIterations = typeof session.scramMaxIterations === "number" ? session.scramMaxIterations : DEFAULT_MAX_SCRAM_ITERATIONS;
    if (scramMaxIterations !== 0 && sv.iteration > scramMaxIterations) {
      throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: iteration count " + sv.iteration + " exceeds scramMaxIterations of " + scramMaxIterations);
    }
    const clientFirstMessageBare = "n=*,r=" + session.clientNonce;
    const serverFirstMessage = "r=" + sv.nonce + ",s=" + sv.salt + ",i=" + sv.iteration;
    let channelBinding = stream ? "eSws" : "biws";
    if (session.mechanism === "SCRAM-SHA-256-PLUS") {
      const peerCert = stream.getPeerCertificate().raw;
      let hashName = signatureAlgorithmHashFromCertificate(peerCert);
      if (hashName === "MD5" || hashName === "SHA-1")
        hashName = "SHA-256";
      const certHash = await crypto.hashByName(hashName, peerCert);
      const bindingData = Buffer.concat([Buffer.from("p=tls-server-end-point,,"), Buffer.from(certHash)]);
      channelBinding = bindingData.toString("base64");
    }
    const clientFinalMessageWithoutProof = "c=" + channelBinding + ",r=" + sv.nonce;
    const authMessage = clientFirstMessageBare + "," + serverFirstMessage + "," + clientFinalMessageWithoutProof;
    const saltBytes = Buffer.from(sv.salt, "base64");
    const saltedPassword = await crypto.deriveKey(saslprep(password), saltBytes, sv.iteration);
    const clientKey = await crypto.hmacSha256(saltedPassword, "Client Key");
    const storedKey = await crypto.sha256(clientKey);
    const clientSignature = await crypto.hmacSha256(storedKey, authMessage);
    const clientProof = xorBuffers(Buffer.from(clientKey), Buffer.from(clientSignature)).toString("base64");
    const serverKey = await crypto.hmacSha256(saltedPassword, "Server Key");
    const serverSignatureBytes = await crypto.hmacSha256(serverKey, authMessage);
    session.message = "SASLResponse";
    session.serverSignature = Buffer.from(serverSignatureBytes).toString("base64");
    session.response = clientFinalMessageWithoutProof + ",p=" + clientProof;
  }
  function finalizeSession(session, serverData) {
    if (session.message !== "SASLResponse") {
      throw new Error("SASL: Last message was not SASLResponse");
    }
    if (typeof serverData !== "string") {
      throw new Error("SASL: SCRAM-SERVER-FINAL-MESSAGE: serverData must be a string");
    }
    const { serverSignature } = parseServerFinalMessage(serverData);
    if (serverSignature !== session.serverSignature) {
      throw new Error("SASL: SCRAM-SERVER-FINAL-MESSAGE: server signature does not match");
    }
  }
  function isPrintableChars(text) {
    if (typeof text !== "string") {
      throw new TypeError("SASL: text must be a string");
    }
    return text.split("").map((_, i) => text.charCodeAt(i)).every((c) => c >= 33 && c <= 43 || c >= 45 && c <= 126);
  }
  function isBase64(text) {
    return /^(?:[a-zA-Z0-9+/]{4})*(?:[a-zA-Z0-9+/]{2}==|[a-zA-Z0-9+/]{3}=)?$/.test(text);
  }
  function parseAttributePairs(text) {
    if (typeof text !== "string") {
      throw new TypeError("SASL: attribute pairs text must be a string");
    }
    return new Map(text.split(",").map((attrValue) => {
      if (!/^.=/.test(attrValue)) {
        throw new Error("SASL: Invalid attribute pair entry");
      }
      const name = attrValue[0];
      const value = attrValue.substring(2);
      return [name, value];
    }));
  }
  function parseServerFirstMessage(data) {
    const attrPairs = parseAttributePairs(data);
    const nonce = attrPairs.get("r");
    if (!nonce) {
      throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: nonce missing");
    } else if (!isPrintableChars(nonce)) {
      throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: nonce must only contain printable characters");
    }
    const salt = attrPairs.get("s");
    if (!salt) {
      throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: salt missing");
    } else if (!isBase64(salt)) {
      throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: salt must be base64");
    }
    const iterationText = attrPairs.get("i");
    if (!iterationText) {
      throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: iteration missing");
    } else if (!/^[1-9][0-9]*$/.test(iterationText)) {
      throw new Error("SASL: SCRAM-SERVER-FIRST-MESSAGE: invalid iteration count");
    }
    const iteration = parseInt(iterationText, 10);
    return {
      nonce,
      salt,
      iteration
    };
  }
  function parseServerFinalMessage(serverData) {
    const attrPairs = parseAttributePairs(serverData);
    const error2 = attrPairs.get("e");
    const serverSignature = attrPairs.get("v");
    if (error2) {
      throw new Error(`SASL: SCRAM-SERVER-FINAL-MESSAGE: server returned error: "${error2}"`);
    }
    if (!serverSignature) {
      throw new Error("SASL: SCRAM-SERVER-FINAL-MESSAGE: server signature is missing");
    } else if (!isBase64(serverSignature)) {
      throw new Error("SASL: SCRAM-SERVER-FINAL-MESSAGE: server signature must be base64");
    }
    return {
      serverSignature
    };
  }
  function xorBuffers(a, b) {
    if (!Buffer.isBuffer(a)) {
      throw new TypeError("first argument must be a Buffer");
    }
    if (!Buffer.isBuffer(b)) {
      throw new TypeError("second argument must be a Buffer");
    }
    if (a.length !== b.length) {
      throw new Error("Buffer lengths must match");
    }
    if (a.length === 0) {
      throw new Error("Buffers cannot be empty");
    }
    return Buffer.from(a.map((_, i) => a[i] ^ b[i]));
  }
  module.exports = {
    startSession,
    continueSession,
    finalizeSession,
    DEFAULT_MAX_SCRAM_ITERATIONS
  };
});

// ../../node_modules/.bun/pg@8.23.0+00a0136bc273dfed/node_modules/pg/lib/type-overrides.js
var require_type_overrides = __commonJS((exports, module) => {
  var types2 = require_pg_types();
  function TypeOverrides(userTypes) {
    this._types = userTypes || types2;
    this.text = {};
    this.binary = {};
  }
  TypeOverrides.prototype.getOverrides = function(format) {
    switch (format) {
      case "text":
        return this.text;
      case "binary":
        return this.binary;
      default:
        return {};
    }
  };
  TypeOverrides.prototype.setTypeParser = function(oid, format, parseFn) {
    if (typeof format === "function") {
      parseFn = format;
      format = "text";
    }
    this.getOverrides(format)[oid] = parseFn;
  };
  TypeOverrides.prototype.getTypeParser = function(oid, format) {
    format = format || "text";
    return this.getOverrides(format)[oid] || this._types.getTypeParser(oid, format);
  };
  module.exports = TypeOverrides;
});

// ../../node_modules/.bun/pg-connection-string@2.14.0/node_modules/pg-connection-string/index.js
var require_pg_connection_string = __commonJS((exports, module) => {
  function parse4(str, options = {}) {
    if (str.charAt(0) === "/") {
      const config3 = str.split(" ");
      return { host: config3[0], database: config3[1] };
    }
    const config2 = Object.create(null);
    let result;
    let dummyHost = false;
    if (/ |%[^a-f0-9]|%[a-f0-9][^a-f0-9]/i.test(str)) {
      str = encodeURI(str).replace(/%25(\d\d)/g, "%$1");
    }
    try {
      try {
        result = new URL(str, "postgres://base");
      } catch (e) {
        result = new URL(str.replace("@/", "@___DUMMY___/"), "postgres://base");
        dummyHost = true;
      }
    } catch (err) {
      err.input && (err.input = "*****REDACTED*****");
      throw err;
    }
    for (const entry of result.searchParams.entries()) {
      config2[entry[0]] = entry[1];
    }
    config2.user = config2.user || decodeURIComponent(result.username);
    config2.password = config2.password || decodeURIComponent(result.password);
    if (result.protocol == "socket:") {
      config2.host = decodeURI(result.pathname);
      config2.database = result.searchParams.get("db");
      config2.client_encoding = result.searchParams.get("encoding");
      return config2;
    }
    const hostname2 = dummyHost ? "" : result.hostname;
    if (!config2.host) {
      config2.host = decodeURIComponent(hostname2);
    } else if (hostname2 && /^%2f/i.test(hostname2)) {
      result.pathname = hostname2 + result.pathname;
    }
    if (!config2.port) {
      config2.port = result.port;
    }
    const pathname = result.pathname.slice(1) || null;
    config2.database = pathname ? decodeURI(pathname) : null;
    if (config2.ssl === "true" || config2.ssl === "1") {
      config2.ssl = true;
    }
    if (config2.ssl === "0") {
      config2.ssl = false;
    }
    if (config2.sslcert || config2.sslkey || config2.sslrootcert || config2.sslmode) {
      config2.ssl = {};
    }
    if (config2.sslnegotiation === "direct" && config2.ssl === undefined) {
      config2.ssl = true;
    }
    const fs = config2.sslcert || config2.sslkey || config2.sslrootcert ? __require("fs") : null;
    if (config2.sslcert) {
      config2.ssl.cert = fs.readFileSync(config2.sslcert).toString();
    }
    if (config2.sslkey) {
      config2.ssl.key = fs.readFileSync(config2.sslkey).toString();
    }
    if (config2.sslrootcert) {
      config2.ssl.ca = fs.readFileSync(config2.sslrootcert).toString();
    }
    if (options.useLibpqCompat && config2.uselibpqcompat) {
      throw new Error("Both useLibpqCompat and uselibpqcompat are set. Please use only one of them.");
    }
    if (config2.uselibpqcompat === "true" || options.useLibpqCompat) {
      switch (config2.sslmode) {
        case "disable": {
          config2.ssl = false;
          break;
        }
        case "prefer": {
          config2.ssl.rejectUnauthorized = false;
          break;
        }
        case "require": {
          if (config2.sslrootcert) {
            config2.ssl.checkServerIdentity = function() {};
          } else {
            config2.ssl.rejectUnauthorized = false;
          }
          break;
        }
        case "verify-ca": {
          if (!config2.ssl.ca) {
            throw new Error("SECURITY WARNING: Using sslmode=verify-ca requires specifying a CA with sslrootcert. If a public CA is used, verify-ca allows connections to a server that somebody else may have registered with the CA, making you vulnerable to Man-in-the-Middle attacks. Either specify a custom CA certificate with sslrootcert parameter or use sslmode=verify-full for proper security.");
          }
          config2.ssl.checkServerIdentity = function() {};
          break;
        }
        case "verify-full": {
          break;
        }
      }
    } else {
      switch (config2.sslmode) {
        case "disable": {
          config2.ssl = false;
          break;
        }
        case "prefer":
        case "require":
        case "verify-ca":
        case "verify-full": {
          if (config2.sslmode !== "verify-full") {
            deprecatedSslModeWarning(config2.sslmode);
          }
          break;
        }
        case "no-verify": {
          config2.ssl.rejectUnauthorized = false;
          break;
        }
      }
    }
    return config2;
  }
  function toConnectionOptions(sslConfig) {
    const connectionOptions = Object.entries(sslConfig).reduce((c, [key, value]) => {
      if (value !== undefined && value !== null) {
        c[key] = value;
      }
      return c;
    }, Object.create(null));
    return connectionOptions;
  }
  function toClientConfig(config2) {
    const poolConfig = Object.entries(config2).reduce((c, [key, value]) => {
      if (key === "ssl") {
        const sslConfig = value;
        if (typeof sslConfig === "boolean") {
          c[key] = sslConfig;
        }
        if (typeof sslConfig === "object") {
          c[key] = toConnectionOptions(sslConfig);
        }
      } else if (value !== undefined && value !== null) {
        if (key === "port") {
          if (value !== "") {
            const v = parseInt(value, 10);
            if (isNaN(v)) {
              throw new Error(`Invalid ${key}: ${value}`);
            }
            c[key] = v;
          }
        } else {
          c[key] = value;
        }
      }
      return c;
    }, Object.create(null));
    return poolConfig;
  }
  function parseIntoClientConfig(str) {
    return toClientConfig(parse4(str));
  }
  function deprecatedSslModeWarning(sslmode) {
    if (!deprecatedSslModeWarning.warned && typeof process !== "undefined" && process.emitWarning) {
      deprecatedSslModeWarning.warned = true;
      process.emitWarning(`SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca' are treated as aliases for 'verify-full'.
In the next major version (pg-connection-string v3.0.0 and pg v9.0.0), these modes will adopt standard libpq semantics, which have weaker security guarantees.

To prepare for this change:
- If you want the current behavior, explicitly use 'sslmode=verify-full'
- If you want libpq compatibility now, use 'uselibpqcompat=true&sslmode=${sslmode}'

See https://www.postgresql.org/docs/current/libpq-ssl.html for libpq SSL mode definitions.`);
    }
  }
  module.exports = parse4;
  parse4.parse = parse4;
  parse4.toClientConfig = toClientConfig;
  parse4.parseIntoClientConfig = parseIntoClientConfig;
});

// ../../node_modules/.bun/pg@8.23.0+00a0136bc273dfed/node_modules/pg/lib/connection-parameters.js
var require_connection_parameters = __commonJS((exports, module) => {
  var dns = __require("dns");
  var defaults = require_defaults();
  var parse4 = require_pg_connection_string().parse;
  var val = function(key, config2, envVar) {
    if (config2[key]) {
      return config2[key];
    }
    if (envVar === undefined) {
      envVar = process.env["PG" + key.toUpperCase()];
    } else if (envVar === false) {} else {
      envVar = process.env[envVar];
    }
    return envVar || defaults[key];
  };
  var readSSLConfigFromEnvironment = function() {
    switch (process.env.PGSSLMODE) {
      case "disable":
        return false;
      case "prefer":
      case "require":
      case "verify-ca":
      case "verify-full":
        return true;
      case "no-verify":
        return { rejectUnauthorized: false };
    }
    return defaults.ssl;
  };
  var quoteParamValue = function(value) {
    return "'" + ("" + value).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
  };
  var add = function(params, config2, paramName) {
    const value = config2[paramName];
    if (value !== undefined && value !== null) {
      params.push(paramName + "=" + quoteParamValue(value));
    }
  };

  class ConnectionParameters {
    constructor(config2) {
      config2 = typeof config2 === "string" ? parse4(config2) : config2 || {};
      if (config2.connectionString) {
        config2 = Object.assign({}, config2, parse4(config2.connectionString));
      }
      this.user = val("user", config2);
      this.database = val("database", config2);
      if (this.database === undefined) {
        this.database = this.user;
      }
      this.port = parseInt(val("port", config2), 10);
      this.host = val("host", config2);
      Object.defineProperty(this, "password", {
        configurable: true,
        enumerable: false,
        writable: true,
        value: val("password", config2)
      });
      this.binary = val("binary", config2);
      this.options = val("options", config2);
      this.ssl = typeof config2.ssl === "undefined" ? readSSLConfigFromEnvironment() : config2.ssl;
      if (typeof this.ssl === "string") {
        if (this.ssl === "true") {
          this.ssl = true;
        }
      }
      if (this.ssl === "no-verify") {
        this.ssl = { rejectUnauthorized: false };
      }
      if (this.ssl && this.ssl.key) {
        Object.defineProperty(this.ssl, "key", {
          enumerable: false
        });
      }
      this.sslnegotiation = val("sslnegotiation", config2, "PGSSLNEGOTIATION");
      if (this.sslnegotiation !== undefined && this.sslnegotiation !== "postgres" && this.sslnegotiation !== "direct") {
        throw new Error(`Invalid sslnegotiation value: "${this.sslnegotiation}". Valid values are "postgres" and "direct".`);
      }
      if (this.sslnegotiation === "direct" && !this.ssl) {
        throw new Error("sslnegotiation=direct requires SSL to be enabled");
      }
      this.client_encoding = val("client_encoding", config2);
      this.replication = val("replication", config2);
      this.isDomainSocket = !(this.host || "").indexOf("/");
      this.application_name = val("application_name", config2, "PGAPPNAME");
      this.fallback_application_name = val("fallback_application_name", config2, false);
      this.statement_timeout = val("statement_timeout", config2, false);
      this.lock_timeout = val("lock_timeout", config2, false);
      this.idle_in_transaction_session_timeout = val("idle_in_transaction_session_timeout", config2, false);
      this.query_timeout = val("query_timeout", config2, false);
      if (config2.connectionTimeoutMillis === undefined) {
        this.connect_timeout = process.env.PGCONNECT_TIMEOUT || 0;
      } else {
        this.connect_timeout = Math.floor(config2.connectionTimeoutMillis / 1000);
      }
      if (config2.keepAlive === false) {
        this.keepalives = 0;
      } else if (config2.keepAlive === true) {
        this.keepalives = 1;
      }
      if (typeof config2.keepAliveInitialDelayMillis === "number") {
        this.keepalives_idle = Math.floor(config2.keepAliveInitialDelayMillis / 1000);
      }
    }
    getLibpqConnectionString(cb) {
      const params = [];
      add(params, this, "user");
      add(params, this, "password");
      add(params, this, "port");
      add(params, this, "application_name");
      add(params, this, "fallback_application_name");
      add(params, this, "connect_timeout");
      add(params, this, "options");
      const ssl = typeof this.ssl === "object" ? this.ssl : this.ssl ? { sslmode: this.ssl } : {};
      add(params, ssl, "sslmode");
      add(params, ssl, "sslca");
      add(params, ssl, "sslkey");
      add(params, ssl, "sslcert");
      add(params, ssl, "sslrootcert");
      add(params, this, "sslnegotiation");
      if (this.database) {
        params.push("dbname=" + quoteParamValue(this.database));
      }
      if (this.replication) {
        params.push("replication=" + quoteParamValue(this.replication));
      }
      if (this.host) {
        params.push("host=" + quoteParamValue(this.host));
      }
      if (this.isDomainSocket) {
        return cb(null, params.join(" "));
      }
      if (this.client_encoding) {
        params.push("client_encoding=" + quoteParamValue(this.client_encoding));
      }
      dns.lookup(this.host, function(err, address) {
        if (err)
          return cb(err, null);
        params.push("hostaddr=" + quoteParamValue(address));
        return cb(null, params.join(" "));
      });
    }
  }
  module.exports = ConnectionParameters;
});

// ../../node_modules/.bun/pg@8.23.0+00a0136bc273dfed/node_modules/pg/lib/result.js
var require_result = __commonJS((exports, module) => {
  var types2 = require_pg_types();
  var matchRegexp = /^([A-Za-z]+)(?: (\d+))?(?: (\d+))?/;

  class Result {
    constructor(rowMode, types3) {
      this.command = null;
      this.rowCount = null;
      this.oid = null;
      this.rows = [];
      this.fields = [];
      this._parsers = undefined;
      this._types = types3;
      this.RowCtor = null;
      this.rowAsArray = rowMode === "array";
      if (this.rowAsArray) {
        this.parseRow = this._parseRowAsArray;
      }
      this._prebuiltEmptyResultObject = null;
    }
    addCommandComplete(msg) {
      let match;
      if (msg.text) {
        match = matchRegexp.exec(msg.text);
      } else {
        match = matchRegexp.exec(msg.command);
      }
      if (match) {
        this.command = match[1];
        if (match[3]) {
          this.oid = parseInt(match[2], 10);
          this.rowCount = parseInt(match[3], 10);
        } else if (match[2]) {
          this.rowCount = parseInt(match[2], 10);
        }
      }
    }
    _parseRowAsArray(rowData) {
      const row = new Array(rowData.length);
      for (let i = 0, len = rowData.length;i < len; i++) {
        const rawValue = rowData[i];
        if (rawValue !== null) {
          row[i] = this._parsers[i](rawValue);
        } else {
          row[i] = null;
        }
      }
      return row;
    }
    parseRow(rowData) {
      const row = { ...this._prebuiltEmptyResultObject };
      for (let i = 0, len = rowData.length;i < len; i++) {
        const rawValue = rowData[i];
        const field = this.fields[i].name;
        if (rawValue !== null) {
          const v = this.fields[i].format === "binary" ? Buffer.from(rawValue) : rawValue;
          row[field] = this._parsers[i](v);
        } else {
          row[field] = null;
        }
      }
      return row;
    }
    addRow(row) {
      this.rows.push(row);
    }
    addFields(fieldDescriptions) {
      this.fields = fieldDescriptions;
      if (this.fields.length) {
        this._parsers = new Array(fieldDescriptions.length);
      }
      const row = Object.create(null);
      for (let i = 0;i < fieldDescriptions.length; i++) {
        const desc = fieldDescriptions[i];
        row[desc.name] = null;
        if (this._types) {
          this._parsers[i] = this._types.getTypeParser(desc.dataTypeID, desc.format || "text");
        } else {
          this._parsers[i] = types2.getTypeParser(desc.dataTypeID, desc.format || "text");
        }
      }
      this._prebuiltEmptyResultObject = { ...row };
    }
  }
  module.exports = Result;
});

// ../../node_modules/.bun/pg@8.23.0+00a0136bc273dfed/node_modules/pg/lib/query.js
var require_query = __commonJS((exports, module) => {
  var { EventEmitter } = __require("events");
  var Result = require_result();
  var utils = require_utils();

  class Query extends EventEmitter {
    constructor(config2, values, callback) {
      super();
      config2 = utils.normalizeQueryConfig(config2, values, callback);
      this.text = config2.text;
      this.values = config2.values;
      this.rows = config2.rows;
      this.types = config2.types;
      this.name = config2.name;
      this.queryMode = config2.queryMode;
      this.binary = config2.binary;
      this.portal = config2.portal || "";
      this.callback = config2.callback;
      this._rowMode = config2.rowMode;
      if (process.domain && config2.callback) {
        this.callback = process.domain.bind(config2.callback);
      }
      this._result = new Result(this._rowMode, this.types);
      this._results = this._result;
      this._canceledDueToError = false;
    }
    requiresPreparation() {
      if (this.queryMode === "extended") {
        return true;
      }
      if (this.name) {
        return true;
      }
      if (this.rows) {
        return true;
      }
      if (!this.text) {
        return false;
      }
      if (!this.values) {
        return false;
      }
      return this.values.length > 0;
    }
    _checkForMultirow() {
      if (this._result.command) {
        if (!Array.isArray(this._results)) {
          this._results = [this._result];
        }
        this._result = new Result(this._rowMode, this._result._types);
        this._results.push(this._result);
      }
    }
    handleRowDescription(msg) {
      this._checkForMultirow();
      this._result.addFields(msg.fields);
      this._accumulateRows = this.callback || !this.listeners("row").length;
    }
    handleDataRow(msg) {
      let row;
      if (this._canceledDueToError) {
        return;
      }
      try {
        row = this._result.parseRow(msg.fields);
      } catch (err) {
        this._canceledDueToError = err;
        return;
      }
      this.emit("row", row, this._result);
      if (this._accumulateRows) {
        this._result.addRow(row);
      }
    }
    handleCommandComplete(msg, connection) {
      this._checkForMultirow();
      this._result.addCommandComplete(msg);
      if (this.rows) {
        connection.sync();
      }
    }
    handleEmptyQuery(connection) {
      if (this.rows) {
        connection.sync();
      }
    }
    handleError(err, connection) {
      if (this._canceledDueToError) {
        err = this._canceledDueToError;
        this._canceledDueToError = false;
      }
      if (this.callback) {
        return this.callback(err);
      }
      this.emit("error", err);
    }
    handleReadyForQuery(con) {
      if (this._canceledDueToError) {
        return this.handleError(this._canceledDueToError, con);
      }
      if (this.callback) {
        try {
          this.callback(null, this._results);
        } catch (err) {
          process.nextTick(() => {
            throw err;
          });
        }
      }
      this.emit("end", this._results);
    }
    submit(connection) {
      if (typeof this.text !== "string" && typeof this.name !== "string") {
        return new Error("A query must have either text or a name. Supplying neither is unsupported.");
      }
      const previous = connection.parsedStatements[this.name] || connection.submittedNamedStatements[this.name];
      if (this.text && previous && this.text !== previous) {
        return new Error(`Prepared statements must be unique - '${this.name}' was used for a different statement`);
      }
      if (this.values && !Array.isArray(this.values)) {
        return new Error("Query values must be an array");
      }
      if (this.requiresPreparation()) {
        connection.stream.cork && connection.stream.cork();
        try {
          this.prepare(connection);
        } finally {
          connection.stream.uncork && connection.stream.uncork();
        }
      } else {
        connection.query(this.text);
      }
      return null;
    }
    hasBeenParsed(connection) {
      return this.name && (connection.parsedStatements[this.name] || connection.submittedNamedStatements[this.name]);
    }
    handlePortalSuspended(connection) {
      this._getRows(connection, this.rows);
    }
    _getRows(connection, rows) {
      connection.execute({
        portal: this.portal,
        rows
      });
      if (!rows) {
        connection.sync();
      } else {
        connection.flush();
      }
    }
    prepare(connection) {
      if (!this.hasBeenParsed(connection)) {
        connection.parse({
          text: this.text,
          name: this.name,
          types: this.types
        });
        if (this.name) {
          connection.submittedNamedStatements[this.name] = this.text;
        }
      }
      try {
        connection.bind({
          portal: this.portal,
          statement: this.name,
          values: this.values,
          binary: this.binary,
          valueMapper: utils.prepareValue
        });
      } catch (err) {
        connection.close({ type: "S", name: this.name });
        connection.sync();
        this.handleError(err, connection);
        return;
      }
      connection.describe({
        type: "P",
        name: this.portal || ""
      });
      this._getRows(connection, this.rows);
    }
    handleCopyInResponse(connection) {
      connection.sendCopyFail("No source stream defined");
    }
    handleCopyData(msg, connection) {}
  }
  module.exports = Query;
});

// ../../node_modules/.bun/pg-protocol@1.16.0/node_modules/pg-protocol/dist/messages.js
var require_messages = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.NoticeMessage = exports.DataRowMessage = exports.CommandCompleteMessage = exports.ReadyForQueryMessage = exports.NotificationResponseMessage = exports.BackendKeyDataMessage = exports.AuthenticationMD5Password = exports.ParameterStatusMessage = exports.ParameterDescriptionMessage = exports.RowDescriptionMessage = exports.Field = exports.CopyResponse = exports.CopyDataMessage = exports.DatabaseError = exports.copyDone = exports.emptyQuery = exports.replicationStart = exports.portalSuspended = exports.noData = exports.closeComplete = exports.bindComplete = exports.parseComplete = undefined;
  exports.parseComplete = {
    name: "parseComplete",
    length: 5
  };
  exports.bindComplete = {
    name: "bindComplete",
    length: 5
  };
  exports.closeComplete = {
    name: "closeComplete",
    length: 5
  };
  exports.noData = {
    name: "noData",
    length: 5
  };
  exports.portalSuspended = {
    name: "portalSuspended",
    length: 5
  };
  exports.replicationStart = {
    name: "replicationStart",
    length: 4
  };
  exports.emptyQuery = {
    name: "emptyQuery",
    length: 4
  };
  exports.copyDone = {
    name: "copyDone",
    length: 4
  };

  class DatabaseError extends Error {
    constructor(message, length, name) {
      super(message);
      this.length = length;
      this.name = name;
    }
  }
  exports.DatabaseError = DatabaseError;

  class CopyDataMessage {
    constructor(length, chunk) {
      this.length = length;
      this.chunk = chunk;
      this.name = "copyData";
    }
  }
  exports.CopyDataMessage = CopyDataMessage;

  class CopyResponse {
    constructor(length, name, binary, columnCount) {
      this.length = length;
      this.name = name;
      this.binary = binary;
      this.columnTypes = new Array(columnCount);
    }
  }
  exports.CopyResponse = CopyResponse;

  class Field {
    constructor(name, tableID, columnID, dataTypeID, dataTypeSize, dataTypeModifier, format) {
      this.name = name;
      this.tableID = tableID;
      this.columnID = columnID;
      this.dataTypeID = dataTypeID;
      this.dataTypeSize = dataTypeSize;
      this.dataTypeModifier = dataTypeModifier;
      this.format = format;
    }
  }
  exports.Field = Field;

  class RowDescriptionMessage {
    constructor(length, fieldCount) {
      this.length = length;
      this.fieldCount = fieldCount;
      this.name = "rowDescription";
      this.fields = new Array(this.fieldCount);
    }
  }
  exports.RowDescriptionMessage = RowDescriptionMessage;

  class ParameterDescriptionMessage {
    constructor(length, parameterCount) {
      this.length = length;
      this.parameterCount = parameterCount;
      this.name = "parameterDescription";
      this.dataTypeIDs = new Array(this.parameterCount);
    }
  }
  exports.ParameterDescriptionMessage = ParameterDescriptionMessage;

  class ParameterStatusMessage {
    constructor(length, parameterName, parameterValue) {
      this.length = length;
      this.parameterName = parameterName;
      this.parameterValue = parameterValue;
      this.name = "parameterStatus";
    }
  }
  exports.ParameterStatusMessage = ParameterStatusMessage;

  class AuthenticationMD5Password {
    constructor(length, salt) {
      this.length = length;
      this.salt = salt;
      this.name = "authenticationMD5Password";
    }
  }
  exports.AuthenticationMD5Password = AuthenticationMD5Password;

  class BackendKeyDataMessage {
    constructor(length, processID, secretKey) {
      this.length = length;
      this.processID = processID;
      this.secretKey = secretKey;
      this.name = "backendKeyData";
    }
  }
  exports.BackendKeyDataMessage = BackendKeyDataMessage;

  class NotificationResponseMessage {
    constructor(length, processId, channel, payload) {
      this.length = length;
      this.processId = processId;
      this.channel = channel;
      this.payload = payload;
      this.name = "notification";
    }
  }
  exports.NotificationResponseMessage = NotificationResponseMessage;

  class ReadyForQueryMessage {
    constructor(length, status) {
      this.length = length;
      this.status = status;
      this.name = "readyForQuery";
    }
  }
  exports.ReadyForQueryMessage = ReadyForQueryMessage;

  class CommandCompleteMessage {
    constructor(length, text) {
      this.length = length;
      this.text = text;
      this.name = "commandComplete";
    }
  }
  exports.CommandCompleteMessage = CommandCompleteMessage;

  class DataRowMessage {
    constructor(length, fields) {
      this.length = length;
      this.fields = fields;
      this.name = "dataRow";
      this.fieldCount = fields.length;
    }
  }
  exports.DataRowMessage = DataRowMessage;

  class NoticeMessage {
    constructor(length, message) {
      this.length = length;
      this.message = message;
      this.name = "notice";
    }
  }
  exports.NoticeMessage = NoticeMessage;
});

// ../../node_modules/.bun/pg-protocol@1.16.0/node_modules/pg-protocol/dist/buffer-writer.js
var require_buffer_writer = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.Writer = undefined;

  class Writer {
    constructor(size = 256) {
      this.size = size;
      this.offset = 5;
      this.headerPosition = 0;
      this.buffer = Buffer.allocUnsafe(size);
    }
    ensure(size) {
      const remaining = this.buffer.length - this.offset;
      if (remaining < size) {
        const oldBuffer = this.buffer;
        const newSize = oldBuffer.length + (oldBuffer.length >> 1) + size;
        this.buffer = Buffer.allocUnsafe(newSize);
        oldBuffer.copy(this.buffer);
      }
    }
    addInt32(num) {
      this.ensure(4);
      this.buffer[this.offset++] = num >>> 24 & 255;
      this.buffer[this.offset++] = num >>> 16 & 255;
      this.buffer[this.offset++] = num >>> 8 & 255;
      this.buffer[this.offset++] = num >>> 0 & 255;
      return this;
    }
    addInt16(num) {
      this.ensure(2);
      this.buffer[this.offset++] = num >>> 8 & 255;
      this.buffer[this.offset++] = num >>> 0 & 255;
      return this;
    }
    addCString(string3) {
      if (!string3) {
        this.ensure(1);
      } else {
        const len = Buffer.byteLength(string3);
        this.ensure(len + 1);
        this.buffer.write(string3, this.offset, "utf-8");
        this.offset += len;
      }
      this.buffer[this.offset++] = 0;
      return this;
    }
    addString(string3 = "") {
      const len = Buffer.byteLength(string3);
      this.ensure(len);
      this.buffer.write(string3, this.offset);
      this.offset += len;
      return this;
    }
    addInt32PrefixedString(string3) {
      const len = Buffer.byteLength(string3);
      this.ensure(4 + len);
      const buffer = this.buffer;
      let offset = this.offset;
      buffer[offset++] = len >>> 24 & 255;
      buffer[offset++] = len >>> 16 & 255;
      buffer[offset++] = len >>> 8 & 255;
      buffer[offset++] = len >>> 0 & 255;
      buffer.write(string3, offset, "utf-8");
      this.offset = offset + len;
      return this;
    }
    add(otherBuffer) {
      this.ensure(otherBuffer.length);
      otherBuffer.copy(this.buffer, this.offset);
      this.offset += otherBuffer.length;
      return this;
    }
    join(code) {
      if (code) {
        this.buffer[this.headerPosition] = code;
        const length = this.offset - (this.headerPosition + 1);
        this.buffer.writeInt32BE(length, this.headerPosition + 1);
      }
      return this.buffer.slice(code ? 0 : 5, this.offset);
    }
    flush(code) {
      const result = this.join(code);
      this.offset = 5;
      this.headerPosition = 0;
      this.buffer = Buffer.allocUnsafe(this.size);
      return result;
    }
    clear() {
      this.offset = 5;
      this.headerPosition = 0;
    }
  }
  exports.Writer = Writer;
});

// ../../node_modules/.bun/pg-protocol@1.16.0/node_modules/pg-protocol/dist/serializer.js
var require_serializer = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.serialize = undefined;
  var buffer_writer_1 = require_buffer_writer();
  var writer = new buffer_writer_1.Writer;
  var startup = (opts) => {
    writer.addInt16(3).addInt16(0);
    for (const key of Object.keys(opts)) {
      writer.addCString(key).addCString(opts[key]);
    }
    writer.addCString("client_encoding").addCString("UTF8");
    const bodyBuffer = writer.addCString("").flush();
    const length = bodyBuffer.length + 4;
    return new buffer_writer_1.Writer().addInt32(length).add(bodyBuffer).flush();
  };
  var requestSsl = () => {
    const response = Buffer.allocUnsafe(8);
    response.writeInt32BE(8, 0);
    response.writeInt32BE(80877103, 4);
    return response;
  };
  var password = (password2) => {
    return writer.addCString(password2).flush(112);
  };
  var sendSASLInitialResponseMessage = function(mechanism, initialResponse) {
    writer.addCString(mechanism).addInt32PrefixedString(initialResponse);
    return writer.flush(112);
  };
  var sendSCRAMClientFinalMessage = function(additionalData) {
    return writer.addString(additionalData).flush(112);
  };
  var query = (text) => {
    return writer.addCString(text).flush(81);
  };
  var emptyArray = [];
  var parse4 = (query2) => {
    const name = query2.name || "";
    if (name.length > 63) {
      console.error("Warning! Postgres only supports 63 characters for query names.");
      console.error("You supplied %s (%s)", name, name.length);
      console.error("This can cause conflicts and silent errors executing queries");
    }
    const types2 = query2.types || emptyArray;
    const len = types2.length;
    const buffer = writer.addCString(name).addCString(query2.text).addInt16(len);
    for (let i = 0;i < len; i++) {
      buffer.addInt32(types2[i]);
    }
    return writer.flush(80);
  };
  var paramWriter = new buffer_writer_1.Writer;
  var writeValues = function(values, valueMapper) {
    for (let i = 0;i < values.length; i++) {
      const mappedVal = valueMapper ? valueMapper(values[i], i) : values[i];
      if (mappedVal == null) {
        writer.addInt16(0);
        paramWriter.addInt32(-1);
      } else if (mappedVal instanceof Buffer) {
        writer.addInt16(1);
        paramWriter.addInt32(mappedVal.length);
        paramWriter.add(mappedVal);
      } else {
        writer.addInt16(0);
        paramWriter.addInt32PrefixedString(mappedVal);
      }
    }
  };
  var bind = (config2 = {}) => {
    const portal = config2.portal || "";
    const statement = config2.statement || "";
    const binary = config2.binary || false;
    const values = config2.values || emptyArray;
    const len = values.length;
    writer.addCString(portal).addCString(statement);
    writer.addInt16(len);
    try {
      writeValues(values, config2.valueMapper);
    } catch (err) {
      writer.clear();
      paramWriter.clear();
      throw err;
    }
    writer.addInt16(len);
    writer.add(paramWriter.flush());
    writer.addInt16(1);
    writer.addInt16(binary ? 1 : 0);
    return writer.flush(66);
  };
  var emptyExecute = Buffer.from([69, 0, 0, 0, 9, 0, 0, 0, 0, 0]);
  var execute = (config2) => {
    if (!config2 || !config2.portal && !config2.rows) {
      return emptyExecute;
    }
    const portal = config2.portal || "";
    const rows = config2.rows || 0;
    const portalLength = Buffer.byteLength(portal);
    const len = 4 + portalLength + 1 + 4;
    const buff = Buffer.allocUnsafe(1 + len);
    buff[0] = 69;
    buff.writeInt32BE(len, 1);
    buff.write(portal, 5, "utf-8");
    buff[portalLength + 5] = 0;
    buff.writeUInt32BE(rows, buff.length - 4);
    return buff;
  };
  var cancel = (processID, secretKey) => {
    const buffer = Buffer.allocUnsafe(16);
    buffer.writeInt32BE(16, 0);
    buffer.writeInt16BE(1234, 4);
    buffer.writeInt16BE(5678, 6);
    buffer.writeInt32BE(processID, 8);
    buffer.writeInt32BE(secretKey, 12);
    return buffer;
  };
  var cstringMessage = (code, string3) => {
    const stringLen = Buffer.byteLength(string3);
    const len = 4 + stringLen + 1;
    const buffer = Buffer.allocUnsafe(1 + len);
    buffer[0] = code;
    buffer.writeInt32BE(len, 1);
    buffer.write(string3, 5, "utf-8");
    buffer[len] = 0;
    return buffer;
  };
  var emptyDescribePortal = writer.addCString("P").flush(68);
  var emptyDescribeStatement = writer.addCString("S").flush(68);
  var describe = (msg) => {
    return msg.name ? cstringMessage(68, `${msg.type}${msg.name || ""}`) : msg.type === "P" ? emptyDescribePortal : emptyDescribeStatement;
  };
  var close = (msg) => {
    const text = `${msg.type}${msg.name || ""}`;
    return cstringMessage(67, text);
  };
  var copyData = (chunk) => {
    return writer.add(chunk).flush(100);
  };
  var copyFail = (message) => {
    return cstringMessage(102, message);
  };
  var codeOnlyBuffer = (code) => Buffer.from([code, 0, 0, 0, 4]);
  var flushBuffer = codeOnlyBuffer(72);
  var syncBuffer = codeOnlyBuffer(83);
  var endBuffer = codeOnlyBuffer(88);
  var copyDoneBuffer = codeOnlyBuffer(99);
  var serialize = {
    startup,
    password,
    requestSsl,
    sendSASLInitialResponseMessage,
    sendSCRAMClientFinalMessage,
    query,
    parse: parse4,
    bind,
    execute,
    describe,
    close,
    flush: () => flushBuffer,
    sync: () => syncBuffer,
    end: () => endBuffer,
    copyData,
    copyDone: () => copyDoneBuffer,
    copyFail,
    cancel
  };
  exports.serialize = serialize;
});

// ../../node_modules/.bun/pg-protocol@1.16.0/node_modules/pg-protocol/dist/buffer-reader.js
var require_buffer_reader = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.BufferReader = undefined;

  class BufferReader {
    constructor(offset = 0) {
      this.offset = offset;
      this.buffer = Buffer.allocUnsafe(0);
      this.encoding = "utf-8";
    }
    setBuffer(offset, buffer) {
      this.offset = offset;
      this.buffer = buffer;
    }
    int16() {
      const result = this.buffer.readInt16BE(this.offset);
      this.offset += 2;
      return result;
    }
    byte() {
      const result = this.buffer[this.offset];
      this.offset++;
      return result;
    }
    int32() {
      const result = this.buffer.readInt32BE(this.offset);
      this.offset += 4;
      return result;
    }
    uint32() {
      const result = this.buffer.readUInt32BE(this.offset);
      this.offset += 4;
      return result;
    }
    string(length) {
      const result = this.buffer.toString(this.encoding, this.offset, this.offset + length);
      this.offset += length;
      return result;
    }
    cstring() {
      const start = this.offset;
      let end = start;
      while (this.buffer[end++]) {}
      this.offset = end;
      return this.buffer.toString(this.encoding, start, end - 1);
    }
    bytes(length) {
      const result = this.buffer.slice(this.offset, this.offset + length);
      this.offset += length;
      return result;
    }
  }
  exports.BufferReader = BufferReader;
});

// ../../node_modules/.bun/pg-protocol@1.16.0/node_modules/pg-protocol/dist/parser.js
var require_parser = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.Parser = undefined;
  var messages_1 = require_messages();
  var buffer_reader_1 = require_buffer_reader();
  var CODE_LENGTH = 1;
  var LEN_LENGTH = 4;
  var HEADER_LENGTH = CODE_LENGTH + LEN_LENGTH;
  var LATEINIT_LENGTH = -1;
  var emptyBuffer = Buffer.allocUnsafe(0);

  class Parser {
    constructor(opts) {
      this.buffer = emptyBuffer;
      this.bufferLength = 0;
      this.bufferOffset = 0;
      this.reader = new buffer_reader_1.BufferReader;
      if ((opts === null || opts === undefined ? undefined : opts.mode) === "binary") {
        throw new Error("Binary mode not supported yet");
      }
      this.mode = (opts === null || opts === undefined ? undefined : opts.mode) || "text";
    }
    parse(buffer, callback) {
      this.mergeBuffer(buffer);
      const bufferFullLength = this.bufferOffset + this.bufferLength;
      let offset = this.bufferOffset;
      while (offset + HEADER_LENGTH <= bufferFullLength) {
        const code = this.buffer[offset];
        const length = this.buffer.readUInt32BE(offset + CODE_LENGTH);
        const fullMessageLength = CODE_LENGTH + length;
        if (fullMessageLength + offset <= bufferFullLength) {
          const message = this.handlePacket(offset + HEADER_LENGTH, code, length, this.buffer);
          callback(message);
          offset += fullMessageLength;
        } else {
          break;
        }
      }
      if (offset === bufferFullLength) {
        this.buffer = emptyBuffer;
        this.bufferLength = 0;
        this.bufferOffset = 0;
      } else {
        this.bufferLength = bufferFullLength - offset;
        this.bufferOffset = offset;
      }
    }
    mergeBuffer(buffer) {
      if (this.bufferLength > 0) {
        const newLength = this.bufferLength + buffer.byteLength;
        const newFullLength = newLength + this.bufferOffset;
        if (newFullLength > this.buffer.byteLength) {
          let newBuffer;
          if (newLength <= this.buffer.byteLength && this.bufferOffset >= this.bufferLength) {
            newBuffer = this.buffer;
          } else {
            let newBufferLength = this.buffer.byteLength * 2;
            while (newLength >= newBufferLength) {
              newBufferLength *= 2;
            }
            newBuffer = Buffer.allocUnsafe(newBufferLength);
          }
          this.buffer.copy(newBuffer, 0, this.bufferOffset, this.bufferOffset + this.bufferLength);
          this.buffer = newBuffer;
          this.bufferOffset = 0;
        }
        buffer.copy(this.buffer, this.bufferOffset + this.bufferLength);
        this.bufferLength = newLength;
      } else {
        this.buffer = buffer;
        this.bufferOffset = 0;
        this.bufferLength = buffer.byteLength;
      }
    }
    handlePacket(offset, code, length, bytes) {
      const { reader } = this;
      reader.setBuffer(offset, bytes);
      let message;
      switch (code) {
        case 50:
          message = messages_1.bindComplete;
          break;
        case 49:
          message = messages_1.parseComplete;
          break;
        case 51:
          message = messages_1.closeComplete;
          break;
        case 110:
          message = messages_1.noData;
          break;
        case 115:
          message = messages_1.portalSuspended;
          break;
        case 99:
          message = messages_1.copyDone;
          break;
        case 87:
          message = messages_1.replicationStart;
          break;
        case 73:
          message = messages_1.emptyQuery;
          break;
        case 68:
          message = parseDataRowMessage(reader);
          break;
        case 67:
          message = parseCommandCompleteMessage(reader);
          break;
        case 90:
          message = parseReadyForQueryMessage(reader);
          break;
        case 65:
          message = parseNotificationMessage(reader);
          break;
        case 82:
          message = parseAuthenticationResponse(reader, length);
          break;
        case 83:
          message = parseParameterStatusMessage(reader);
          break;
        case 75:
          message = parseBackendKeyData(reader);
          break;
        case 69:
          message = parseErrorMessage(reader, "error");
          break;
        case 78:
          message = parseErrorMessage(reader, "notice");
          break;
        case 84:
          message = parseRowDescriptionMessage(reader);
          break;
        case 116:
          message = parseParameterDescriptionMessage(reader);
          break;
        case 71:
          message = parseCopyInMessage(reader);
          break;
        case 72:
          message = parseCopyOutMessage(reader);
          break;
        case 100:
          message = parseCopyData(reader, length);
          break;
        default:
          return new messages_1.DatabaseError("received invalid response: " + code.toString(16), length, "error");
      }
      reader.setBuffer(0, emptyBuffer);
      message.length = length;
      return message;
    }
  }
  exports.Parser = Parser;
  var parseReadyForQueryMessage = (reader) => {
    const status = reader.string(1);
    return new messages_1.ReadyForQueryMessage(LATEINIT_LENGTH, status);
  };
  var parseCommandCompleteMessage = (reader) => {
    const text = reader.cstring();
    return new messages_1.CommandCompleteMessage(LATEINIT_LENGTH, text);
  };
  var parseCopyData = (reader, length) => {
    const chunk = reader.bytes(length - 4);
    return new messages_1.CopyDataMessage(LATEINIT_LENGTH, chunk);
  };
  var parseCopyInMessage = (reader) => parseCopyMessage(reader, "copyInResponse");
  var parseCopyOutMessage = (reader) => parseCopyMessage(reader, "copyOutResponse");
  var parseCopyMessage = (reader, messageName) => {
    const isBinary = reader.byte() !== 0;
    const columnCount = reader.int16();
    const message = new messages_1.CopyResponse(LATEINIT_LENGTH, messageName, isBinary, columnCount);
    for (let i = 0;i < columnCount; i++) {
      message.columnTypes[i] = reader.int16();
    }
    return message;
  };
  var parseNotificationMessage = (reader) => {
    const processId = reader.int32();
    const channel = reader.cstring();
    const payload = reader.cstring();
    return new messages_1.NotificationResponseMessage(LATEINIT_LENGTH, processId, channel, payload);
  };
  var parseRowDescriptionMessage = (reader) => {
    const fieldCount = reader.int16();
    const message = new messages_1.RowDescriptionMessage(LATEINIT_LENGTH, fieldCount);
    for (let i = 0;i < fieldCount; i++) {
      message.fields[i] = parseField(reader);
    }
    return message;
  };
  var parseField = (reader) => {
    const name = reader.cstring();
    const tableID = reader.uint32();
    const columnID = reader.int16();
    const dataTypeID = reader.uint32();
    const dataTypeSize = reader.int16();
    const dataTypeModifier = reader.int32();
    const mode = reader.int16() === 0 ? "text" : "binary";
    return new messages_1.Field(name, tableID, columnID, dataTypeID, dataTypeSize, dataTypeModifier, mode);
  };
  var parseParameterDescriptionMessage = (reader) => {
    const parameterCount = reader.int16();
    const message = new messages_1.ParameterDescriptionMessage(LATEINIT_LENGTH, parameterCount);
    for (let i = 0;i < parameterCount; i++) {
      message.dataTypeIDs[i] = reader.uint32();
    }
    return message;
  };
  var parseDataRowMessage = (reader) => {
    const fieldCount = reader.int16();
    const fields = new Array(fieldCount);
    for (let i = 0;i < fieldCount; i++) {
      const len = reader.int32();
      fields[i] = len === -1 ? null : reader.string(len);
    }
    return new messages_1.DataRowMessage(LATEINIT_LENGTH, fields);
  };
  var parseParameterStatusMessage = (reader) => {
    const name = reader.cstring();
    const value = reader.cstring();
    return new messages_1.ParameterStatusMessage(LATEINIT_LENGTH, name, value);
  };
  var parseBackendKeyData = (reader) => {
    const processID = reader.int32();
    const secretKey = reader.int32();
    return new messages_1.BackendKeyDataMessage(LATEINIT_LENGTH, processID, secretKey);
  };
  var parseAuthenticationResponse = (reader, length) => {
    const code = reader.int32();
    const message = {
      name: "authenticationOk",
      length
    };
    switch (code) {
      case 0:
        break;
      case 3:
        if (message.length === 8) {
          message.name = "authenticationCleartextPassword";
        }
        break;
      case 5:
        if (message.length === 12) {
          message.name = "authenticationMD5Password";
          const salt = reader.bytes(4);
          return new messages_1.AuthenticationMD5Password(LATEINIT_LENGTH, salt);
        }
        break;
      case 10:
        {
          message.name = "authenticationSASL";
          message.mechanisms = [];
          let mechanism;
          do {
            mechanism = reader.cstring();
            if (mechanism) {
              message.mechanisms.push(mechanism);
            }
          } while (mechanism);
        }
        break;
      case 11:
        message.name = "authenticationSASLContinue";
        message.data = reader.string(length - 8);
        break;
      case 12:
        message.name = "authenticationSASLFinal";
        message.data = reader.string(length - 8);
        break;
      default:
        throw new Error("Unknown authenticationOk message type " + code);
    }
    return message;
  };
  var parseErrorMessage = (reader, name) => {
    const fields = {};
    let fieldType = reader.string(1);
    while (fieldType !== "\x00") {
      fields[fieldType] = reader.cstring();
      fieldType = reader.string(1);
    }
    const messageValue = fields.M;
    const message = name === "notice" ? new messages_1.NoticeMessage(LATEINIT_LENGTH, messageValue) : new messages_1.DatabaseError(messageValue, LATEINIT_LENGTH, name);
    message.severity = fields.S;
    message.code = fields.C;
    message.detail = fields.D;
    message.hint = fields.H;
    message.position = fields.P;
    message.internalPosition = fields.p;
    message.internalQuery = fields.q;
    message.where = fields.W;
    message.schema = fields.s;
    message.table = fields.t;
    message.column = fields.c;
    message.dataType = fields.d;
    message.constraint = fields.n;
    message.file = fields.F;
    message.line = fields.L;
    message.routine = fields.R;
    return message;
  };
});

// ../../node_modules/.bun/pg-protocol@1.16.0/node_modules/pg-protocol/dist/index.js
var require_dist = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.DatabaseError = exports.serialize = undefined;
  exports.parse = parse4;
  var messages_1 = require_messages();
  Object.defineProperty(exports, "DatabaseError", { enumerable: true, get: function() {
    return messages_1.DatabaseError;
  } });
  var serializer_1 = require_serializer();
  Object.defineProperty(exports, "serialize", { enumerable: true, get: function() {
    return serializer_1.serialize;
  } });
  var parser_1 = require_parser();
  function parse4(stream, callback) {
    const parser = new parser_1.Parser;
    stream.on("data", (buffer) => parser.parse(buffer, callback));
    return new Promise((resolve4) => stream.on("end", () => resolve4()));
  }
});

// ../../node_modules/.bun/pg-cloudflare@1.4.0/node_modules/pg-cloudflare/dist/empty.js
var require_empty = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.default = {};
});

// ../../node_modules/.bun/pg@8.23.0+00a0136bc273dfed/node_modules/pg/lib/stream.js
var require_stream = __commonJS((exports, module) => {
  var { getStream, getSecureStream } = getStreamFuncs();
  module.exports = {
    getStream,
    getSecureStream
  };
  function getNodejsStreamFuncs() {
    function getStream2(ssl) {
      const net = __require("net");
      return new net.Socket;
    }
    function getSecureStream2(options) {
      const tls = __require("tls");
      return tls.connect(options);
    }
    return {
      getStream: getStream2,
      getSecureStream: getSecureStream2
    };
  }
  function getCloudflareStreamFuncs() {
    function getStream2(ssl) {
      const { CloudflareSocket } = require_empty();
      return new CloudflareSocket(ssl);
    }
    function getSecureStream2(options) {
      options.socket.startTls(options);
      return options.socket;
    }
    return {
      getStream: getStream2,
      getSecureStream: getSecureStream2
    };
  }
  function isCloudflareRuntime() {
    if (typeof navigator === "object" && navigator !== null && typeof navigator.userAgent === "string") {
      return navigator.userAgent === "Cloudflare-Workers";
    }
    if (typeof Response === "function") {
      const resp = new Response(null, { cf: { thing: true } });
      if (typeof resp.cf === "object" && resp.cf !== null && resp.cf.thing) {
        return true;
      }
    }
    return false;
  }
  function getStreamFuncs() {
    if (isCloudflareRuntime()) {
      return getCloudflareStreamFuncs();
    }
    return getNodejsStreamFuncs();
  }
});

// ../../node_modules/.bun/pg@8.23.0+00a0136bc273dfed/node_modules/pg/lib/connection.js
var require_connection = __commonJS((exports, module) => {
  var EventEmitter = __require("events").EventEmitter;
  var { parse: parse4, serialize } = require_dist();
  var stream = require_stream();
  var { getStream } = stream;
  var flushBuffer = serialize.flush();
  var syncBuffer = serialize.sync();
  var endBuffer = serialize.end();

  class Connection extends EventEmitter {
    constructor(config2) {
      super();
      config2 = config2 || {};
      this.stream = config2.stream || getStream(config2.ssl);
      if (typeof this.stream === "function") {
        this.stream = this.stream(config2);
      }
      this._keepAlive = config2.keepAlive;
      this._keepAliveInitialDelayMillis = config2.keepAliveInitialDelayMillis;
      this.parsedStatements = {};
      this.submittedNamedStatements = {};
      this.ssl = config2.ssl || false;
      this.sslNegotiation = config2.sslNegotiation || "postgres";
      this._ending = false;
      this._emitMessage = false;
      const self = this;
      this.on("newListener", function(eventName) {
        if (eventName === "message") {
          self._emitMessage = true;
        }
      });
    }
    connect(port, host) {
      const self = this;
      this._connecting = true;
      this.stream.setNoDelay(true);
      this.stream.connect(port, host);
      this.stream.once("connect", function() {
        if (self._keepAlive) {
          self.stream.setKeepAlive(true, self._keepAliveInitialDelayMillis);
        }
        self.emit("connect");
      });
      const reportStreamError = function(error2) {
        if (self._ending && (error2.code === "ECONNRESET" || error2.code === "EPIPE")) {
          return;
        }
        self.emit("error", error2);
      };
      this.stream.on("error", reportStreamError);
      this.stream.on("close", function() {
        self.emit("end");
      });
      if (!this.ssl) {
        return this.attachListeners(this.stream);
      }
      if (this.sslNegotiation === "direct") {
        return this.stream.once("connect", function() {
          self.upgradeToSSL(host, reportStreamError);
        });
      }
      this.stream.once("data", function(buffer) {
        const responseCode = buffer.toString("utf8");
        switch (responseCode) {
          case "S":
            break;
          case "N":
            self.stream.end();
            return self.emit("error", new Error("The server does not support SSL connections"));
          default:
            self.stream.end();
            return self.emit("error", new Error("There was an error establishing an SSL connection"));
        }
        self.upgradeToSSL(host, reportStreamError);
      });
    }
    upgradeToSSL(host, reportStreamError) {
      const self = this;
      const options = {
        socket: self.stream
      };
      if (self.ssl !== true) {
        Object.assign(options, self.ssl);
        if ("key" in self.ssl) {
          options.key = self.ssl.key;
        }
      }
      if (self.sslNegotiation === "direct") {
        options.ALPNProtocols = ["postgresql"];
      }
      const net = __require("net");
      if (net.isIP && net.isIP(host) === 0) {
        options.servername = host;
      }
      try {
        self.stream = stream.getSecureStream(options);
      } catch (err) {
        return self.emit("error", err);
      }
      self.attachListeners(self.stream);
      self.stream.on("error", reportStreamError);
      self.emit("sslconnect");
    }
    attachListeners(stream2) {
      parse4(stream2, (msg) => {
        const eventName = msg.name === "error" ? "errorMessage" : msg.name;
        if (this._emitMessage) {
          this.emit("message", msg);
        }
        this.emit(eventName, msg);
      });
    }
    requestSsl() {
      this.stream.write(serialize.requestSsl());
    }
    startup(config2) {
      this.stream.write(serialize.startup(config2));
    }
    cancel(processID, secretKey) {
      this._send(serialize.cancel(processID, secretKey));
    }
    password(password) {
      this._send(serialize.password(password));
    }
    sendSASLInitialResponseMessage(mechanism, initialResponse) {
      this._send(serialize.sendSASLInitialResponseMessage(mechanism, initialResponse));
    }
    sendSCRAMClientFinalMessage(additionalData) {
      this._send(serialize.sendSCRAMClientFinalMessage(additionalData));
    }
    _send(buffer) {
      if (!this.stream.writable) {
        return false;
      }
      return this.stream.write(buffer);
    }
    query(text) {
      this._send(serialize.query(text));
    }
    parse(query) {
      this._send(serialize.parse(query));
    }
    bind(config2) {
      this._send(serialize.bind(config2));
    }
    execute(config2) {
      this._send(serialize.execute(config2));
    }
    flush() {
      if (this.stream.writable) {
        this.stream.write(flushBuffer);
      }
    }
    sync() {
      this._ending = true;
      this._send(syncBuffer);
    }
    ref() {
      this.stream.ref();
    }
    unref() {
      this.stream.unref();
    }
    end() {
      this._ending = true;
      if (!this._connecting || !this.stream.writable) {
        this.stream.end();
        return;
      }
      return this.stream.write(endBuffer, () => {
        this.stream.end();
      });
    }
    close(msg) {
      this._send(serialize.close(msg));
    }
    describe(msg) {
      this._send(serialize.describe(msg));
    }
    sendCopyFromChunk(chunk) {
      this._send(serialize.copyData(chunk));
    }
    endCopyFrom() {
      this._send(serialize.copyDone());
    }
    sendCopyFail(msg) {
      this._send(serialize.copyFail(msg));
    }
  }
  module.exports = Connection;
});

// ../../node_modules/.bun/split2@4.2.0/node_modules/split2/index.js
var require_split2 = __commonJS((exports, module) => {
  var { Transform } = __require("stream");
  var { StringDecoder } = __require("string_decoder");
  var kLast = Symbol("last");
  var kDecoder = Symbol("decoder");
  function transform2(chunk, enc, cb) {
    let list;
    if (this.overflow) {
      const buf = this[kDecoder].write(chunk);
      list = buf.split(this.matcher);
      if (list.length === 1)
        return cb();
      list.shift();
      this.overflow = false;
    } else {
      this[kLast] += this[kDecoder].write(chunk);
      list = this[kLast].split(this.matcher);
    }
    this[kLast] = list.pop();
    for (let i = 0;i < list.length; i++) {
      try {
        push(this, this.mapper(list[i]));
      } catch (error2) {
        return cb(error2);
      }
    }
    this.overflow = this[kLast].length > this.maxLength;
    if (this.overflow && !this.skipOverflow) {
      cb(new Error("maximum buffer reached"));
      return;
    }
    cb();
  }
  function flush(cb) {
    this[kLast] += this[kDecoder].end();
    if (this[kLast]) {
      try {
        push(this, this.mapper(this[kLast]));
      } catch (error2) {
        return cb(error2);
      }
    }
    cb();
  }
  function push(self, val) {
    if (val !== undefined) {
      self.push(val);
    }
  }
  function noop(incoming) {
    return incoming;
  }
  function split(matcher, mapper, options) {
    matcher = matcher || /\r?\n/;
    mapper = mapper || noop;
    options = options || {};
    switch (arguments.length) {
      case 1:
        if (typeof matcher === "function") {
          mapper = matcher;
          matcher = /\r?\n/;
        } else if (typeof matcher === "object" && !(matcher instanceof RegExp) && !matcher[Symbol.split]) {
          options = matcher;
          matcher = /\r?\n/;
        }
        break;
      case 2:
        if (typeof matcher === "function") {
          options = mapper;
          mapper = matcher;
          matcher = /\r?\n/;
        } else if (typeof mapper === "object") {
          options = mapper;
          mapper = noop;
        }
    }
    options = Object.assign({}, options);
    options.autoDestroy = true;
    options.transform = transform2;
    options.flush = flush;
    options.readableObjectMode = true;
    const stream = new Transform(options);
    stream[kLast] = "";
    stream[kDecoder] = new StringDecoder("utf8");
    stream.matcher = matcher;
    stream.mapper = mapper;
    stream.maxLength = options.maxLength;
    stream.skipOverflow = options.skipOverflow || false;
    stream.overflow = false;
    stream._destroy = function(err, cb) {
      this._writableState.errorEmitted = false;
      cb(err);
    };
    return stream;
  }
  module.exports = split;
});

// ../../node_modules/.bun/pgpass@1.0.5/node_modules/pgpass/lib/helper.js
var require_helper = __commonJS((exports, module) => {
  var path = __require("path");
  var Stream = __require("stream").Stream;
  var split = require_split2();
  var util3 = __require("util");
  var defaultPort = 5432;
  var isWin = process.platform === "win32";
  var warnStream = process.stderr;
  var S_IRWXG = 56;
  var S_IRWXO = 7;
  var S_IFMT = 61440;
  var S_IFREG = 32768;
  function isRegFile(mode) {
    return (mode & S_IFMT) == S_IFREG;
  }
  var fieldNames = ["host", "port", "database", "user", "password"];
  var nrOfFields = fieldNames.length;
  var passKey = fieldNames[nrOfFields - 1];
  function warn() {
    var isWritable = warnStream instanceof Stream && warnStream.writable === true;
    if (isWritable) {
      var args = Array.prototype.slice.call(arguments).concat(`
`);
      warnStream.write(util3.format.apply(util3, args));
    }
  }
  Object.defineProperty(exports, "isWin", {
    get: function() {
      return isWin;
    },
    set: function(val) {
      isWin = val;
    }
  });
  exports.warnTo = function(stream) {
    var old = warnStream;
    warnStream = stream;
    return old;
  };
  exports.getFileName = function(rawEnv) {
    var env = rawEnv || process.env;
    var file = env.PGPASSFILE || (isWin ? path.join(env.APPDATA || "./", "postgresql", "pgpass.conf") : path.join(env.HOME || "./", ".pgpass"));
    return file;
  };
  exports.usePgPass = function(stats, fname) {
    if (Object.prototype.hasOwnProperty.call(process.env, "PGPASSWORD")) {
      return false;
    }
    if (isWin) {
      return true;
    }
    fname = fname || "<unkn>";
    if (!isRegFile(stats.mode)) {
      warn('WARNING: password file "%s" is not a plain file', fname);
      return false;
    }
    if (stats.mode & (S_IRWXG | S_IRWXO)) {
      warn('WARNING: password file "%s" has group or world access; permissions should be u=rw (0600) or less', fname);
      return false;
    }
    return true;
  };
  var matcher = exports.match = function(connInfo, entry) {
    return fieldNames.slice(0, -1).reduce(function(prev, field, idx) {
      if (idx == 1) {
        if (Number(connInfo[field] || defaultPort) === Number(entry[field])) {
          return prev && true;
        }
      }
      return prev && (entry[field] === "*" || entry[field] === connInfo[field]);
    }, true);
  };
  exports.getPassword = function(connInfo, stream, cb) {
    var pass;
    var lineStream = stream.pipe(split());
    function onLine(line) {
      var entry = parseLine(line);
      if (entry && isValidEntry(entry) && matcher(connInfo, entry)) {
        pass = entry[passKey];
        lineStream.end();
      }
    }
    var onEnd = function() {
      stream.destroy();
      cb(pass);
    };
    var onErr = function(err) {
      stream.destroy();
      warn("WARNING: error on reading file: %s", err);
      cb(undefined);
    };
    stream.on("error", onErr);
    lineStream.on("data", onLine).on("end", onEnd).on("error", onErr);
  };
  var parseLine = exports.parseLine = function(line) {
    if (line.length < 11 || line.match(/^\s+#/)) {
      return null;
    }
    var curChar = "";
    var prevChar = "";
    var fieldIdx = 0;
    var startIdx = 0;
    var endIdx = 0;
    var obj = {};
    var isLastField = false;
    var addToObj = function(idx, i0, i1) {
      var field = line.substring(i0, i1);
      if (!Object.hasOwnProperty.call(process.env, "PGPASS_NO_DEESCAPE")) {
        field = field.replace(/\\([:\\])/g, "$1");
      }
      obj[fieldNames[idx]] = field;
    };
    for (var i = 0;i < line.length - 1; i += 1) {
      curChar = line.charAt(i + 1);
      prevChar = line.charAt(i);
      isLastField = fieldIdx == nrOfFields - 1;
      if (isLastField) {
        addToObj(fieldIdx, startIdx);
        break;
      }
      if (i >= 0 && curChar == ":" && prevChar !== "\\") {
        addToObj(fieldIdx, startIdx, i + 1);
        startIdx = i + 2;
        fieldIdx += 1;
      }
    }
    obj = Object.keys(obj).length === nrOfFields ? obj : null;
    return obj;
  };
  var isValidEntry = exports.isValidEntry = function(entry) {
    var rules = {
      0: function(x) {
        return x.length > 0;
      },
      1: function(x) {
        if (x === "*") {
          return true;
        }
        x = Number(x);
        return isFinite(x) && x > 0 && x < 9007199254740992 && Math.floor(x) === x;
      },
      2: function(x) {
        return x.length > 0;
      },
      3: function(x) {
        return x.length > 0;
      },
      4: function(x) {
        return x.length > 0;
      }
    };
    for (var idx = 0;idx < fieldNames.length; idx += 1) {
      var rule = rules[idx];
      var value = entry[fieldNames[idx]] || "";
      var res = rule(value);
      if (!res) {
        return false;
      }
    }
    return true;
  };
});

// ../../node_modules/.bun/pgpass@1.0.5/node_modules/pgpass/lib/index.js
var require_lib = __commonJS((exports, module) => {
  var path = __require("path");
  var fs = __require("fs");
  var helper = require_helper();
  module.exports = function(connInfo, cb) {
    var file = helper.getFileName();
    fs.stat(file, function(err, stat) {
      if (err || !helper.usePgPass(stat, file)) {
        return cb(undefined);
      }
      var st = fs.createReadStream(file);
      helper.getPassword(connInfo, st, cb);
    });
  };
  module.exports.warnTo = helper.warnTo;
});

// ../../node_modules/.bun/pg@8.23.0+00a0136bc273dfed/node_modules/pg/lib/client.js
var require_client = __commonJS((exports, module) => {
  var EventEmitter = __require("events").EventEmitter;
  var utils = require_utils();
  var nodeUtils = __require("util");
  var sasl = require_sasl();
  var TypeOverrides = require_type_overrides();
  var ConnectionParameters = require_connection_parameters();
  var Query = require_query();
  var defaults = require_defaults();
  var Connection = require_connection();
  var crypto = require_utils2();
  var activeQueryDeprecationNotice = nodeUtils.deprecate(() => {}, "Client.activeQuery is deprecated and will be removed in pg@9.0");
  var queryQueueDeprecationNotice = nodeUtils.deprecate(() => {}, "Client.queryQueue is deprecated and will be removed in pg@9.0.");
  var pgPassDeprecationNotice = nodeUtils.deprecate(() => {}, "pgpass support is deprecated and will be removed in pg@9.0. " + "You can provide an async function as the password property to the Client/Pool constructor that returns a password instead. Within this function you can call the pgpass module in your own code.");
  var byoPromiseDeprecationNotice = nodeUtils.deprecate(() => {}, "Passing a custom Promise implementation to the Client/Pool constructor is deprecated and will be removed in pg@9.0.");
  var queryQueueLengthDeprecationNotice = nodeUtils.deprecate(() => {}, "Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.");
  function coerceNumberOrDefault(value, defaultValue) {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : defaultValue;
    }
    if (typeof value === "string" && value.trim() !== "") {
      const n = Number(value);
      return Number.isFinite(n) ? n : defaultValue;
    }
    return defaultValue;
  }

  class Client extends EventEmitter {
    constructor(config2) {
      super();
      this.connectionParameters = new ConnectionParameters(config2);
      this.user = this.connectionParameters.user;
      this.database = this.connectionParameters.database;
      this.port = this.connectionParameters.port;
      this.host = this.connectionParameters.host;
      Object.defineProperty(this, "password", {
        configurable: true,
        enumerable: false,
        writable: true,
        value: this.connectionParameters.password
      });
      this.replication = this.connectionParameters.replication;
      const c = config2 || {};
      if (c.Promise) {
        byoPromiseDeprecationNotice();
      }
      this._Promise = c.Promise || global.Promise;
      this._types = new TypeOverrides(c.types);
      this._ending = false;
      this._ended = false;
      this._connecting = false;
      this._connected = false;
      this._connectionError = false;
      this._queryable = true;
      this._activeQuery = null;
      this._txStatus = null;
      this.enableChannelBinding = Boolean(c.enableChannelBinding);
      this.scramMaxIterations = coerceNumberOrDefault(c.scramMaxIterations, sasl.DEFAULT_MAX_SCRAM_ITERATIONS);
      this.connection = c.connection || new Connection({
        stream: c.stream,
        ssl: this.connectionParameters.ssl,
        sslNegotiation: this.connectionParameters.sslnegotiation,
        keepAlive: c.keepAlive || false,
        keepAliveInitialDelayMillis: c.keepAliveInitialDelayMillis || 0,
        encoding: this.connectionParameters.client_encoding || "utf8"
      });
      this._queryQueue = [];
      this._sentQueryQueue = [];
      this.pipeline = Boolean(c.pipeline);
      this.binary = c.binary || defaults.binary;
      this.processID = null;
      this.secretKey = null;
      this.ssl = this.connectionParameters.ssl || false;
      this.sslNegotiation = this.connectionParameters.sslnegotiation || "postgres";
      if (this.ssl && this.ssl.key) {
        Object.defineProperty(this.ssl, "key", {
          enumerable: false
        });
      }
      this._connectionTimeoutMillis = c.connectionTimeoutMillis || 0;
    }
    get activeQuery() {
      activeQueryDeprecationNotice();
      return this._activeQuery;
    }
    set activeQuery(val) {
      activeQueryDeprecationNotice();
      this._activeQuery = val;
    }
    _getActiveQuery() {
      return this._activeQuery;
    }
    _errorAllQueries(err) {
      const enqueueError = (query) => {
        process.nextTick(() => {
          query.handleError(err, this.connection);
        });
      };
      const activeQuery = this._getActiveQuery();
      if (activeQuery) {
        enqueueError(activeQuery);
        this._activeQuery = null;
      }
      this._sentQueryQueue.forEach(enqueueError);
      this._sentQueryQueue.length = 0;
      this._queryQueue.forEach(enqueueError);
      this._queryQueue.length = 0;
    }
    _connect(callback) {
      const self = this;
      const con = this.connection;
      this._connectionCallback = callback;
      if (this._connecting || this._connected) {
        const err = new Error("Client has already been connected. You cannot reuse a client.");
        process.nextTick(() => {
          callback(err);
        });
        return;
      }
      this._connecting = true;
      if (this._connectionTimeoutMillis > 0) {
        this.connectionTimeoutHandle = setTimeout(() => {
          con._ending = true;
          con.stream.destroy(new Error("timeout expired"));
        }, this._connectionTimeoutMillis);
        if (this.connectionTimeoutHandle.unref) {
          this.connectionTimeoutHandle.unref();
        }
      }
      if (this.host && this.host.indexOf("/") === 0) {
        con.connect(this.host + "/.s.PGSQL." + this.port);
      } else {
        con.connect(this.port, this.host);
      }
      con.on("connect", function() {
        if (self.ssl) {
          if (self.sslNegotiation !== "direct") {
            con.requestSsl();
          }
        } else {
          con.startup(self.getStartupConf());
        }
      });
      con.on("sslconnect", function() {
        con.startup(self.getStartupConf());
      });
      this._attachListeners(con);
      con.once("end", () => {
        const error2 = this._ending ? new Error("Connection terminated") : new Error("Connection terminated unexpectedly");
        clearTimeout(this.connectionTimeoutHandle);
        this._errorAllQueries(error2);
        this._ended = true;
        if (!this._ending) {
          if (this._connecting && !this._connectionError) {
            if (this._connectionCallback) {
              this._connectionCallback(error2);
            } else {
              this._handleErrorEvent(error2);
            }
          } else if (!this._connectionError) {
            this._handleErrorEvent(error2);
          }
        }
        process.nextTick(() => {
          this.emit("end");
        });
      });
    }
    connect(callback) {
      if (callback) {
        this._connect(callback);
        return;
      }
      return new this._Promise((resolve4, reject) => {
        this._connect((error2) => {
          if (error2) {
            reject(error2);
          } else {
            resolve4(this);
          }
        });
      });
    }
    _attachListeners(con) {
      con.on("authenticationCleartextPassword", this._handleAuthCleartextPassword.bind(this));
      con.on("authenticationMD5Password", this._handleAuthMD5Password.bind(this));
      con.on("authenticationSASL", this._handleAuthSASL.bind(this));
      con.on("authenticationSASLContinue", this._handleAuthSASLContinue.bind(this));
      con.on("authenticationSASLFinal", this._handleAuthSASLFinal.bind(this));
      con.on("backendKeyData", this._handleBackendKeyData.bind(this));
      con.on("error", this._handleErrorEvent.bind(this));
      con.on("errorMessage", this._handleErrorMessage.bind(this));
      con.on("readyForQuery", this._handleReadyForQuery.bind(this));
      con.on("notice", this._handleNotice.bind(this));
      con.on("rowDescription", this._handleRowDescription.bind(this));
      con.on("dataRow", this._handleDataRow.bind(this));
      con.on("portalSuspended", this._handlePortalSuspended.bind(this));
      con.on("emptyQuery", this._handleEmptyQuery.bind(this));
      con.on("commandComplete", this._handleCommandComplete.bind(this));
      con.on("parseComplete", this._handleParseComplete.bind(this));
      con.on("copyInResponse", this._handleCopyInResponse.bind(this));
      con.on("copyData", this._handleCopyData.bind(this));
      con.on("notification", this._handleNotification.bind(this));
    }
    _getPassword(cb) {
      const con = this.connection;
      if (typeof this.password === "function") {
        this._Promise.resolve().then(() => this.password(this.connectionParameters)).then((pass) => {
          if (pass !== undefined) {
            if (typeof pass !== "string") {
              con.emit("error", new TypeError("Password must be a string"));
              return;
            }
            this.connectionParameters.password = this.password = pass;
          } else {
            this.connectionParameters.password = this.password = null;
          }
          cb();
        }).catch((err) => {
          con.emit("error", err);
        });
      } else if (this.password !== null) {
        cb();
      } else {
        try {
          const pgPass = require_lib();
          pgPass(this.connectionParameters, (pass) => {
            if (pass !== undefined) {
              pgPassDeprecationNotice();
              this.connectionParameters.password = this.password = pass;
            }
            cb();
          });
        } catch (e) {
          this.emit("error", e);
        }
      }
    }
    _handleAuthCleartextPassword(msg) {
      this._getPassword(() => {
        this.connection.password(this.password);
      });
    }
    _handleAuthMD5Password(msg) {
      this._getPassword(async () => {
        try {
          const hashedPassword = await crypto.postgresMd5PasswordHash(this.user, this.password, msg.salt);
          this.connection.password(hashedPassword);
        } catch (e) {
          this.emit("error", e);
        }
      });
    }
    _handleAuthSASL(msg) {
      this._getPassword(() => {
        try {
          this.saslSession = sasl.startSession(msg.mechanisms, this.enableChannelBinding && this.connection.stream, this.scramMaxIterations);
          this.connection.sendSASLInitialResponseMessage(this.saslSession.mechanism, this.saslSession.response);
        } catch (err) {
          this.connection.emit("error", err);
        }
      });
    }
    async _handleAuthSASLContinue(msg) {
      try {
        await sasl.continueSession(this.saslSession, this.password, msg.data, this.enableChannelBinding && this.connection.stream);
        this.connection.sendSCRAMClientFinalMessage(this.saslSession.response);
      } catch (err) {
        this.connection.emit("error", err);
      }
    }
    _handleAuthSASLFinal(msg) {
      try {
        sasl.finalizeSession(this.saslSession, msg.data);
        this.saslSession = null;
      } catch (err) {
        this.connection.emit("error", err);
      }
    }
    _handleBackendKeyData(msg) {
      this.processID = msg.processID;
      this.secretKey = msg.secretKey;
    }
    _handleReadyForQuery(msg) {
      if (this._connecting) {
        this._connecting = false;
        this._connected = true;
        clearTimeout(this.connectionTimeoutHandle);
        if (this._connectionCallback) {
          this._connectionCallback(null, this);
          this._connectionCallback = null;
        }
        this.emit("connect");
      }
      const activeQuery = this._getActiveQuery();
      this._activeQuery = null;
      this._txStatus = msg?.status ?? null;
      this.readyForQuery = true;
      if (activeQuery) {
        activeQuery.handleReadyForQuery(this.connection);
      }
      this._pulseQueryQueue();
    }
    _handleErrorWhileConnecting(err) {
      if (this._connectionError) {
        return;
      }
      this._connectionError = true;
      clearTimeout(this.connectionTimeoutHandle);
      if (this._connectionCallback) {
        return this._connectionCallback(err);
      }
      this.emit("error", err);
    }
    _handleErrorEvent(err) {
      if (this._connecting) {
        return this._handleErrorWhileConnecting(err);
      }
      this._queryable = false;
      this._errorAllQueries(err);
      this.emit("error", err);
    }
    _handleErrorMessage(msg) {
      if (this._connecting) {
        return this._handleErrorWhileConnecting(msg);
      }
      const activeQuery = this._getActiveQuery();
      if (!activeQuery) {
        this._handleErrorEvent(msg);
        return;
      }
      this._activeQuery = null;
      if (activeQuery.name) {
        delete this.connection.submittedNamedStatements[activeQuery.name];
      }
      activeQuery.handleError(msg, this.connection);
    }
    _handleRowDescription(msg) {
      const activeQuery = this._getActiveQuery();
      if (activeQuery == null) {
        const error2 = new Error("Received unexpected rowDescription message from backend.");
        this._handleErrorEvent(error2);
        return;
      }
      activeQuery.handleRowDescription(msg);
    }
    _handleDataRow(msg) {
      const activeQuery = this._getActiveQuery();
      if (activeQuery == null) {
        const error2 = new Error("Received unexpected dataRow message from backend.");
        this._handleErrorEvent(error2);
        return;
      }
      activeQuery.handleDataRow(msg);
    }
    _handlePortalSuspended(msg) {
      const activeQuery = this._getActiveQuery();
      if (activeQuery == null) {
        const error2 = new Error("Received unexpected portalSuspended message from backend.");
        this._handleErrorEvent(error2);
        return;
      }
      activeQuery.handlePortalSuspended(this.connection);
    }
    _handleEmptyQuery(msg) {
      const activeQuery = this._getActiveQuery();
      if (activeQuery == null) {
        const error2 = new Error("Received unexpected emptyQuery message from backend.");
        this._handleErrorEvent(error2);
        return;
      }
      activeQuery.handleEmptyQuery(this.connection);
    }
    _handleCommandComplete(msg) {
      const activeQuery = this._getActiveQuery();
      if (activeQuery == null) {
        const error2 = new Error("Received unexpected commandComplete message from backend.");
        this._handleErrorEvent(error2);
        return;
      }
      activeQuery.handleCommandComplete(msg, this.connection);
    }
    _handleParseComplete() {
      const activeQuery = this._getActiveQuery();
      if (activeQuery == null) {
        const error2 = new Error("Received unexpected parseComplete message from backend.");
        this._handleErrorEvent(error2);
        return;
      }
      if (activeQuery.name) {
        this.connection.parsedStatements[activeQuery.name] = activeQuery.text;
        delete this.connection.submittedNamedStatements[activeQuery.name];
      }
    }
    _handleCopyInResponse(msg) {
      const activeQuery = this._getActiveQuery();
      if (activeQuery == null) {
        const error2 = new Error("Received unexpected copyInResponse message from backend.");
        this._handleErrorEvent(error2);
        return;
      }
      activeQuery.handleCopyInResponse(this.connection);
    }
    _handleCopyData(msg) {
      const activeQuery = this._getActiveQuery();
      if (activeQuery == null) {
        const error2 = new Error("Received unexpected copyData message from backend.");
        this._handleErrorEvent(error2);
        return;
      }
      activeQuery.handleCopyData(msg, this.connection);
    }
    _handleNotification(msg) {
      this.emit("notification", msg);
    }
    _handleNotice(msg) {
      this.emit("notice", msg);
    }
    getStartupConf() {
      const params = this.connectionParameters;
      const data = {
        user: params.user,
        database: params.database
      };
      const appName = params.application_name || params.fallback_application_name;
      if (appName) {
        data.application_name = appName;
      }
      if (params.replication) {
        data.replication = "" + params.replication;
      }
      if (params.statement_timeout) {
        data.statement_timeout = String(parseInt(params.statement_timeout, 10));
      }
      if (params.lock_timeout) {
        data.lock_timeout = String(parseInt(params.lock_timeout, 10));
      }
      if (params.idle_in_transaction_session_timeout) {
        data.idle_in_transaction_session_timeout = String(parseInt(params.idle_in_transaction_session_timeout, 10));
      }
      if (params.options) {
        data.options = params.options;
      }
      return data;
    }
    cancel(client, query) {
      if (client.activeQuery === query) {
        const con = this.connection;
        if (this.host && this.host.indexOf("/") === 0) {
          con.connect(this.host + "/.s.PGSQL." + this.port);
        } else {
          con.connect(this.port, this.host);
        }
        con.on("connect", function() {
          con.cancel(client.processID, client.secretKey);
        });
      } else if (client._queryQueue.indexOf(query) !== -1) {
        client._queryQueue.splice(client._queryQueue.indexOf(query), 1);
      } else if (client._sentQueryQueue.indexOf(query) !== -1) {
        query.callback = () => {};
      }
    }
    setTypeParser(oid, format, parseFn) {
      return this._types.setTypeParser(oid, format, parseFn);
    }
    getTypeParser(oid, format) {
      return this._types.getTypeParser(oid, format);
    }
    escapeIdentifier(str) {
      return utils.escapeIdentifier(str);
    }
    escapeLiteral(str) {
      return utils.escapeLiteral(str);
    }
    _pulseQueryQueue() {
      if (this.pipeline) {
        this._pulsePipelinedQueryQueue();
        return;
      }
      if (this.readyForQuery === true) {
        this._activeQuery = this._queryQueue.shift();
        const activeQuery = this._getActiveQuery();
        if (activeQuery) {
          this.readyForQuery = false;
          this.hasExecuted = true;
          const queryError = activeQuery.submit(this.connection);
          if (queryError) {
            process.nextTick(() => {
              activeQuery.handleError(queryError, this.connection);
              this.readyForQuery = true;
              this._pulseQueryQueue();
            });
          }
        } else if (this.hasExecuted) {
          this._activeQuery = null;
          this.emit("drain");
        }
      }
    }
    _pulsePipelinedQueryQueue() {
      if (!this._connected || !this._queryable) {
        return;
      }
      while (this._queryQueue.length > 0) {
        const query = this._queryQueue.shift();
        this.hasExecuted = true;
        const queryError = query.submit(this.connection);
        if (queryError) {
          process.nextTick(() => {
            query.handleError(queryError, this.connection);
          });
          continue;
        }
        this._sentQueryQueue.push(query);
      }
      if (this.readyForQuery && !this._activeQuery && this._sentQueryQueue.length > 0) {
        this._activeQuery = this._sentQueryQueue.shift();
        this.readyForQuery = false;
      }
      if (!this._activeQuery && this._sentQueryQueue.length === 0 && this._queryQueue.length === 0 && this.hasExecuted) {
        this.emit("drain");
      }
    }
    query(config2, values, callback) {
      let query;
      let result;
      if (config2 == null) {
        throw new TypeError("Client was passed a null or undefined query");
      }
      if (typeof config2.submit === "function") {
        result = query = config2;
        if (!query.callback) {
          if (typeof values === "function") {
            query.callback = values;
          } else if (callback) {
            query.callback = callback;
          }
        }
      } else {
        query = new Query(config2, values, callback);
        if (!query.callback) {
          result = new this._Promise((resolve4, reject) => {
            query.callback = (err, res) => err ? reject(err) : resolve4(res);
          }).catch((err) => {
            Error.captureStackTrace(err);
            throw err;
          });
        } else if (typeof query.callback !== "function") {
          throw new TypeError("callback is not a function");
        }
      }
      const readTimeout = config2.query_timeout || this.connectionParameters.query_timeout;
      if (readTimeout) {
        const queryCallback = query.callback || (() => {});
        const readTimeoutTimer = setTimeout(() => {
          const error2 = new Error("Query read timeout");
          process.nextTick(() => {
            query.handleError(error2, this.connection);
          });
          queryCallback(error2);
          query.callback = () => {};
          const index = this._queryQueue.indexOf(query);
          if (index > -1) {
            this._queryQueue.splice(index, 1);
          } else if (this.pipeline) {
            this.connection.stream.destroy();
            return;
          }
          this._pulseQueryQueue();
        }, readTimeout);
        query.callback = (err, res) => {
          clearTimeout(readTimeoutTimer);
          queryCallback(err, res);
        };
      }
      if (this.binary && !query.binary) {
        query.binary = true;
      }
      if (query._result && !query._result._types) {
        query._result._types = this._types;
      }
      if (!this._queryable) {
        process.nextTick(() => {
          query.handleError(new Error("Client has encountered a connection error and is not queryable"), this.connection);
        });
        return result;
      }
      if (this._ending) {
        process.nextTick(() => {
          query.handleError(new Error("Client was closed and is not queryable"), this.connection);
        });
        return result;
      }
      if (this._queryQueue.length > 0 && !this.pipeline) {
        queryQueueLengthDeprecationNotice();
      }
      this._queryQueue.push(query);
      this._pulseQueryQueue();
      return result;
    }
    ref() {
      this.connection.ref();
    }
    unref() {
      this.connection.unref();
    }
    getTransactionStatus() {
      return this._txStatus;
    }
    end(cb) {
      this._ending = true;
      if (!this.connection._connecting || this._ended) {
        if (cb) {
          cb();
          return;
        } else {
          return this._Promise.resolve();
        }
      }
      if (!this._queryable) {
        this.connection.stream.destroy();
      } else if (this.pipeline && (this._getActiveQuery() || this._sentQueryQueue.length > 0 || this._queryQueue.length > 0)) {
        this.once("drain", () => this.connection.end());
      } else if (this._getActiveQuery()) {
        this.connection.stream.destroy();
      } else {
        this.connection.end();
      }
      if (cb) {
        this.connection.once("end", cb);
      } else {
        return new this._Promise((resolve4) => {
          this.connection.once("end", resolve4);
        });
      }
    }
    get queryQueue() {
      queryQueueDeprecationNotice();
      return this._queryQueue;
    }
  }
  Client.Query = Query;
  module.exports = Client;
});

// ../../node_modules/.bun/pg-pool@3.14.0+00a0136bc273dfed/node_modules/pg-pool/index.js
var require_pg_pool = __commonJS((exports, module) => {
  var EventEmitter = __require("events").EventEmitter;
  var NOOP = function() {};
  var removeWhere = (list, predicate) => {
    const i = list.findIndex(predicate);
    return i === -1 ? undefined : list.splice(i, 1)[0];
  };

  class IdleItem {
    constructor(client, idleListener, timeoutId) {
      this.client = client;
      this.idleListener = idleListener;
      this.timeoutId = timeoutId;
    }
  }

  class PendingItem {
    constructor(callback) {
      this.callback = callback;
    }
  }
  function throwOnDoubleRelease() {
    throw new Error("Release called on client which has already been released to the pool.");
  }
  function promisify(Promise2, callback) {
    if (callback) {
      return { callback, result: undefined };
    }
    let rej;
    let res;
    const cb = function(err, client) {
      err ? rej(err) : res(client);
    };
    const result = new Promise2(function(resolve4, reject) {
      res = resolve4;
      rej = reject;
    }).catch((err) => {
      Error.captureStackTrace(err);
      throw err;
    });
    return { callback: cb, result };
  }
  function makeIdleListener(pool, client) {
    return function idleListener(err) {
      err.client = client;
      client.removeListener("error", idleListener);
      client.on("error", () => {
        pool.log("additional client error after disconnection due to error", err);
      });
      pool._remove(client);
      pool.emit("error", err, client);
    };
  }

  class Pool extends EventEmitter {
    constructor(options, Client) {
      super();
      this.options = Object.assign({}, options);
      if (options != null && "password" in options) {
        Object.defineProperty(this.options, "password", {
          configurable: true,
          enumerable: false,
          writable: true,
          value: options.password
        });
      }
      if (options != null && options.ssl && options.ssl.key) {
        Object.defineProperty(this.options.ssl, "key", {
          enumerable: false
        });
      }
      this.options.max = this.options.max || this.options.poolSize || 10;
      this.options.min = this.options.min || 0;
      this.options.maxUses = this.options.maxUses || Infinity;
      this.options.allowExitOnIdle = this.options.allowExitOnIdle || false;
      this.options.maxLifetimeSeconds = this.options.maxLifetimeSeconds || 0;
      this.log = this.options.log || function() {};
      this.Client = this.options.Client || Client || require_lib2().Client;
      this.Promise = this.options.Promise || global.Promise;
      if (typeof this.options.idleTimeoutMillis === "undefined") {
        this.options.idleTimeoutMillis = 1e4;
      }
      this._clients = [];
      this._idle = [];
      this._expired = new WeakSet;
      this._pendingQueue = [];
      this._endCallback = undefined;
      this.ending = false;
      this.ended = false;
    }
    _promiseTry(f) {
      const Promise2 = this.Promise;
      if (typeof Promise2.try === "function") {
        return Promise2.try(f);
      }
      return new Promise2((resolve4) => resolve4(f()));
    }
    _isFull() {
      return this._clients.length >= this.options.max;
    }
    _isAboveMin() {
      return this._clients.length > this.options.min;
    }
    _pulseQueue() {
      this.log("pulse queue");
      if (this.ended) {
        this.log("pulse queue ended");
        return;
      }
      if (this.ending) {
        this.log("pulse queue on ending");
        if (this._idle.length) {
          this._idle.slice().map((item) => {
            this._remove(item.client);
          });
        }
        if (!this._clients.length) {
          this.ended = true;
          this._endCallback();
        }
        return;
      }
      if (!this._pendingQueue.length) {
        this.log("no queued requests");
        return;
      }
      if (!this._idle.length && this._isFull()) {
        return;
      }
      const pendingItem = this._pendingQueue.shift();
      if (this._idle.length) {
        const idleItem = this._idle.pop();
        clearTimeout(idleItem.timeoutId);
        const client = idleItem.client;
        client.ref && client.ref();
        const idleListener = idleItem.idleListener;
        return this._acquireClient(client, pendingItem, idleListener, false);
      }
      if (!this._isFull()) {
        return this.newClient(pendingItem);
      }
      throw new Error("unexpected condition");
    }
    _remove(client, callback) {
      const removed = removeWhere(this._idle, (item) => item.client === client);
      if (removed !== undefined) {
        clearTimeout(removed.timeoutId);
      }
      this._clients = this._clients.filter((c) => c !== client);
      const context = this;
      client.end(() => {
        context.emit("remove", client);
        if (typeof callback === "function") {
          callback();
        }
      });
    }
    connect(cb) {
      if (this.ending) {
        const err = new Error("Cannot use a pool after calling end on the pool");
        return cb ? cb(err) : this.Promise.reject(err);
      }
      const response = promisify(this.Promise, cb);
      const result = response.result;
      if (this._isFull() || this._idle.length) {
        if (this._idle.length) {
          process.nextTick(() => this._pulseQueue());
        }
        if (!this.options.connectionTimeoutMillis) {
          this._pendingQueue.push(new PendingItem(response.callback));
          return result;
        }
        const queueCallback = (err, res, done) => {
          clearTimeout(tid);
          response.callback(err, res, done);
        };
        const pendingItem = new PendingItem(queueCallback);
        const tid = setTimeout(() => {
          removeWhere(this._pendingQueue, (i) => i.callback === queueCallback);
          pendingItem.timedOut = true;
          response.callback(new Error("timeout exceeded when trying to connect"));
        }, this.options.connectionTimeoutMillis);
        if (tid.unref) {
          tid.unref();
        }
        this._pendingQueue.push(pendingItem);
        return result;
      }
      this.newClient(new PendingItem(response.callback));
      return result;
    }
    newClient(pendingItem) {
      const client = new this.Client(this.options);
      this._clients.push(client);
      const idleListener = makeIdleListener(this, client);
      this.log("checking client timeout");
      let tid;
      let timeoutHit = false;
      if (this.options.connectionTimeoutMillis) {
        tid = setTimeout(() => {
          if (client.connection) {
            this.log("ending client due to timeout");
            timeoutHit = true;
            client.connection.stream.destroy();
          } else if (!client.isConnected()) {
            this.log("ending client due to timeout");
            timeoutHit = true;
            client.end();
          }
        }, this.options.connectionTimeoutMillis);
      }
      this.log("connecting new client");
      client.connect((err) => {
        if (tid) {
          clearTimeout(tid);
        }
        client.on("error", idleListener);
        if (err) {
          this.log("client failed to connect", err);
          this._clients = this._clients.filter((c) => c !== client);
          if (timeoutHit) {
            err = new Error("Connection terminated due to connection timeout", { cause: err });
          }
          this._pulseQueue();
          if (!pendingItem.timedOut) {
            pendingItem.callback(err, undefined, NOOP);
          }
        } else {
          this.log("new client connected");
          if (this.options.onConnect) {
            this._promiseTry(() => this.options.onConnect(client)).then(() => {
              this._afterConnect(client, pendingItem, idleListener);
            }, (hookErr) => {
              this._clients = this._clients.filter((c) => c !== client);
              client.end(() => {
                this._pulseQueue();
                if (!pendingItem.timedOut) {
                  pendingItem.callback(hookErr, undefined, NOOP);
                }
              });
            });
            return;
          }
          return this._afterConnect(client, pendingItem, idleListener);
        }
      });
    }
    _afterConnect(client, pendingItem, idleListener) {
      if (this.options.maxLifetimeSeconds !== 0) {
        const maxLifetimeTimeout = setTimeout(() => {
          this.log("ending client due to expired lifetime");
          this._expired.add(client);
          const idleIndex = this._idle.findIndex((idleItem) => idleItem.client === client);
          if (idleIndex !== -1) {
            this._acquireClient(client, new PendingItem((err, client2, clientRelease) => clientRelease()), idleListener, false);
          }
        }, this.options.maxLifetimeSeconds * 1000);
        maxLifetimeTimeout.unref();
        client.once("end", () => clearTimeout(maxLifetimeTimeout));
      }
      return this._acquireClient(client, pendingItem, idleListener, true);
    }
    _acquireClient(client, pendingItem, idleListener, isNew) {
      if (isNew) {
        this.emit("connect", client);
      }
      this.emit("acquire", client);
      client.release = this._releaseOnce(client, idleListener);
      client.removeListener("error", idleListener);
      if (!pendingItem.timedOut) {
        if (isNew && this.options.verify) {
          this.options.verify(client, (err) => {
            if (err) {
              client.release(err);
              return pendingItem.callback(err, undefined, NOOP);
            }
            pendingItem.callback(undefined, client, client.release);
          });
        } else {
          pendingItem.callback(undefined, client, client.release);
        }
      } else {
        if (isNew && this.options.verify) {
          this.options.verify(client, client.release);
        } else {
          client.release();
        }
      }
    }
    _releaseOnce(client, idleListener) {
      let released = false;
      return (err) => {
        if (released) {
          throwOnDoubleRelease();
        }
        released = true;
        this._release(client, idleListener, err);
      };
    }
    _release(client, idleListener, err) {
      client.on("error", idleListener);
      client._poolUseCount = (client._poolUseCount || 0) + 1;
      this.emit("release", err, client);
      if (err || this.ending || !client._queryable || client._ending || client._poolUseCount >= this.options.maxUses) {
        if (client._poolUseCount >= this.options.maxUses) {
          this.log("remove expended client");
        }
        return this._remove(client, this._pulseQueue.bind(this));
      }
      const isExpired = this._expired.has(client);
      if (isExpired) {
        this.log("remove expired client");
        this._expired.delete(client);
        return this._remove(client, this._pulseQueue.bind(this));
      }
      let tid;
      if (this.options.idleTimeoutMillis && this._isAboveMin()) {
        tid = setTimeout(() => {
          if (this._isAboveMin()) {
            this.log("remove idle client");
            this._remove(client, this._pulseQueue.bind(this));
          }
        }, this.options.idleTimeoutMillis);
        if (this.options.allowExitOnIdle) {
          tid.unref();
        }
      }
      if (this.options.allowExitOnIdle) {
        client.unref();
      }
      this._idle.push(new IdleItem(client, idleListener, tid));
      this._pulseQueue();
    }
    query(text, values, cb) {
      if (typeof text === "function") {
        const response2 = promisify(this.Promise, text);
        setImmediate(function() {
          return response2.callback(new Error("Passing a function as the first parameter to pool.query is not supported"));
        });
        return response2.result;
      }
      if (typeof values === "function") {
        cb = values;
        values = undefined;
      }
      const response = promisify(this.Promise, cb);
      cb = response.callback;
      this.connect((err, client) => {
        if (err) {
          return cb(err);
        }
        let clientReleased = false;
        const onError = (err2) => {
          if (clientReleased) {
            return;
          }
          clientReleased = true;
          client.release(err2);
          cb(err2);
        };
        client.once("error", onError);
        this.log("dispatching query");
        try {
          client.query(text, values, (err2, res) => {
            this.log("query dispatched");
            client.removeListener("error", onError);
            if (clientReleased) {
              return;
            }
            clientReleased = true;
            client.release(err2);
            if (err2) {
              return cb(err2);
            }
            return cb(undefined, res);
          });
        } catch (err2) {
          client.release(err2);
          return cb(err2);
        }
      });
      return response.result;
    }
    end(cb) {
      this.log("ending");
      if (this.ending) {
        const err = new Error("Called end on pool more than once");
        return cb ? cb(err) : this.Promise.reject(err);
      }
      this.ending = true;
      const promised = promisify(this.Promise, cb);
      this._endCallback = promised.callback;
      this._pulseQueue();
      return promised.result;
    }
    get waitingCount() {
      return this._pendingQueue.length;
    }
    get idleCount() {
      return this._idle.length;
    }
    get expiredCount() {
      return this._clients.reduce((acc, client) => acc + (this._expired.has(client) ? 1 : 0), 0);
    }
    get totalCount() {
      return this._clients.length;
    }
  }
  module.exports = Pool;
});

// ../../node_modules/.bun/pg@8.23.0+00a0136bc273dfed/node_modules/pg/lib/native/query.js
var require_query2 = __commonJS((exports, module) => {
  var EventEmitter = __require("events").EventEmitter;
  var util3 = __require("util");
  var utils = require_utils();
  var NativeQuery = module.exports = function(config2, values, callback) {
    EventEmitter.call(this);
    config2 = utils.normalizeQueryConfig(config2, values, callback);
    this.text = config2.text;
    this.values = config2.values;
    this.name = config2.name;
    this.queryMode = config2.queryMode;
    this.callback = config2.callback;
    this.state = "new";
    this._arrayMode = config2.rowMode === "array";
    this._emitRowEvents = false;
    this.on("newListener", function(event) {
      if (event === "row")
        this._emitRowEvents = true;
    }.bind(this));
  };
  util3.inherits(NativeQuery, EventEmitter);
  var errorFieldMap = {
    sqlState: "code",
    statementPosition: "position",
    messagePrimary: "message",
    context: "where",
    schemaName: "schema",
    tableName: "table",
    columnName: "column",
    dataTypeName: "dataType",
    constraintName: "constraint",
    sourceFile: "file",
    sourceLine: "line",
    sourceFunction: "routine"
  };
  NativeQuery.prototype.handleError = function(err) {
    const fields = this.native && this.native.pq.resultErrorFields();
    if (fields) {
      for (const key in fields) {
        const normalizedFieldName = errorFieldMap[key] || key;
        err[normalizedFieldName] = fields[key];
      }
    }
    if (this.callback) {
      this.callback(err);
    } else {
      this.emit("error", err);
    }
    this.state = "error";
  };
  NativeQuery.prototype.then = function(onSuccess, onFailure) {
    return this._getPromise().then(onSuccess, onFailure);
  };
  NativeQuery.prototype.catch = function(callback) {
    return this._getPromise().catch(callback);
  };
  NativeQuery.prototype._getPromise = function() {
    if (this._promise)
      return this._promise;
    this._promise = new Promise(function(resolve4, reject) {
      this._once("end", resolve4);
      this._once("error", reject);
    }.bind(this));
    return this._promise;
  };
  NativeQuery.prototype.submit = function(client) {
    this.state = "running";
    const self = this;
    this.native = client.native;
    client.native.arrayMode = this._arrayMode;
    let after = function(err, rows, results) {
      client.native.arrayMode = false;
      setImmediate(function() {
        self.emit("_done");
      });
      if (err) {
        return self.handleError(err);
      }
      if (self._emitRowEvents) {
        if (results.length > 1) {
          rows.forEach((rowOfRows, i) => {
            rowOfRows.forEach((row) => {
              self.emit("row", row, results[i]);
            });
          });
        } else {
          rows.forEach(function(row) {
            self.emit("row", row, results);
          });
        }
      }
      self.state = "end";
      self.emit("end", results);
      if (self.callback) {
        self.callback(null, results);
      }
    };
    if (process.domain) {
      after = process.domain.bind(after);
    }
    if (this.name) {
      if (this.name.length > 63) {
        console.error("Warning! Postgres only supports 63 characters for query names.");
        console.error("You supplied %s (%s)", this.name, this.name.length);
        console.error("This can cause conflicts and silent errors executing queries");
      }
      const values = (this.values || []).map(utils.prepareValue);
      if (client.namedQueries[this.name]) {
        if (this.text && client.namedQueries[this.name] !== this.text) {
          const err = new Error(`Prepared statements must be unique - '${this.name}' was used for a different statement`);
          return after(err);
        }
        return client.native.execute(this.name, values, after);
      }
      return client.native.prepare(this.name, this.text, values.length, function(err) {
        if (err)
          return after(err);
        client.namedQueries[self.name] = self.text;
        return self.native.execute(self.name, values, after);
      });
    } else if (this.values) {
      if (!Array.isArray(this.values)) {
        const err = new Error("Query values must be an array");
        return after(err);
      }
      const vals = this.values.map(utils.prepareValue);
      client.native.query(this.text, vals, after);
    } else if (this.queryMode === "extended") {
      client.native.query(this.text, [], after);
    } else {
      client.native.query(this.text, after);
    }
  };
});

// ../../node_modules/.bun/pg@8.23.0+00a0136bc273dfed/node_modules/pg/lib/native/client.js
var require_client2 = __commonJS((exports, module) => {
  var nodeUtils = __require("util");
  var Native;
  try {
    Native = (()=>{throw new Error("Cannot require module "+"pg-native");})();
  } catch (e) {
    throw e;
  }
  var TypeOverrides = require_type_overrides();
  var EventEmitter = __require("events").EventEmitter;
  var util3 = __require("util");
  var ConnectionParameters = require_connection_parameters();
  var NativeQuery = require_query2();
  var queryQueueLengthDeprecationNotice = nodeUtils.deprecate(() => {}, "Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.");
  var Client = module.exports = function(config2) {
    EventEmitter.call(this);
    config2 = config2 || {};
    this._Promise = config2.Promise || global.Promise;
    this._types = new TypeOverrides(config2.types);
    this.native = new Native({
      types: this._types
    });
    this._queryQueue = [];
    this._ending = false;
    this._connecting = false;
    this._connected = false;
    this._queryable = true;
    this.pipeline = Boolean(config2.pipeline);
    this._pipelineInFlight = false;
    const cp = this.connectionParameters = new ConnectionParameters(config2);
    if (config2.nativeConnectionString)
      cp.nativeConnectionString = config2.nativeConnectionString;
    this.user = cp.user;
    Object.defineProperty(this, "password", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: cp.password
    });
    this.database = cp.database;
    this.host = cp.host;
    this.port = cp.port;
    this.namedQueries = {};
  };
  Client.Query = NativeQuery;
  util3.inherits(Client, EventEmitter);
  Client.prototype._errorAllQueries = function(err) {
    const enqueueError = (query) => {
      process.nextTick(() => {
        query.native = this.native;
        query.handleError(err);
      });
    };
    if (this._hasActiveQuery()) {
      enqueueError(this._activeQuery);
      this._activeQuery = null;
    }
    this._queryQueue.forEach(enqueueError);
    this._queryQueue.length = 0;
  };
  Client.prototype._connect = function(cb) {
    const self = this;
    if (this._connecting) {
      process.nextTick(() => cb(new Error("Client has already been connected. You cannot reuse a client.")));
      return;
    }
    this._connecting = true;
    this.connectionParameters.getLibpqConnectionString(function(err, conString) {
      if (self.connectionParameters.nativeConnectionString)
        conString = self.connectionParameters.nativeConnectionString;
      if (err)
        return cb(err);
      self.native.connect(conString, function(err2) {
        if (err2) {
          self.native.end();
          return cb(err2);
        }
        self._connected = true;
        self.native.on("error", function(err3) {
          self._queryable = false;
          self._errorAllQueries(err3);
          self.emit("error", err3);
        });
        self.native.on("notification", function(msg) {
          self.emit("notification", {
            channel: msg.relname,
            payload: msg.extra
          });
        });
        self.emit("connect");
        self._pulseQueryQueue(true);
        cb(null, this);
      });
    });
  };
  Client.prototype.connect = function(callback) {
    if (callback) {
      this._connect(callback);
      return;
    }
    return new this._Promise((resolve4, reject) => {
      this._connect((error2) => {
        if (error2) {
          reject(error2);
        } else {
          resolve4(this);
        }
      });
    });
  };
  Client.prototype.query = function(config2, values, callback) {
    let query;
    let result;
    let readTimeout;
    let readTimeoutTimer;
    let queryCallback;
    if (config2 === null || config2 === undefined) {
      throw new TypeError("Client was passed a null or undefined query");
    } else if (typeof config2.submit === "function") {
      readTimeout = config2.query_timeout || this.connectionParameters.query_timeout;
      result = query = config2;
      if (typeof values === "function") {
        config2.callback = values;
      }
    } else {
      readTimeout = config2.query_timeout || this.connectionParameters.query_timeout;
      query = new NativeQuery(config2, values, callback);
      if (!query.callback) {
        let resolveOut, rejectOut;
        result = new this._Promise((resolve4, reject) => {
          resolveOut = resolve4;
          rejectOut = reject;
        }).catch((err) => {
          Error.captureStackTrace(err);
          throw err;
        });
        query.callback = (err, res) => err ? rejectOut(err) : resolveOut(res);
      }
    }
    if (readTimeout) {
      queryCallback = query.callback || (() => {});
      readTimeoutTimer = setTimeout(() => {
        const error2 = new Error("Query read timeout");
        process.nextTick(() => {
          query.handleError(error2, this.connection);
        });
        queryCallback(error2);
        query.callback = () => {};
        const index = this._queryQueue.indexOf(query);
        if (index > -1) {
          this._queryQueue.splice(index, 1);
        }
        this._pulseQueryQueue();
      }, readTimeout);
      query.callback = (err, res) => {
        clearTimeout(readTimeoutTimer);
        queryCallback(err, res);
      };
    }
    if (!this._queryable) {
      query.native = this.native;
      process.nextTick(() => {
        query.handleError(new Error("Client has encountered a connection error and is not queryable"));
      });
      return result;
    }
    if (this._ending) {
      query.native = this.native;
      process.nextTick(() => {
        query.handleError(new Error("Client was closed and is not queryable"));
      });
      return result;
    }
    if (this._queryQueue.length > 0 && !this.pipeline) {
      queryQueueLengthDeprecationNotice();
    }
    this._queryQueue.push(query);
    this._pulseQueryQueue();
    return result;
  };
  Client.prototype.end = function(cb) {
    const self = this;
    this._ending = true;
    if (this._connecting && !this._connected) {
      this.once("connect", () => {
        this.end(() => {});
      });
    }
    let result;
    if (!cb) {
      result = new this._Promise(function(resolve4, reject) {
        cb = (err) => err ? reject(err) : resolve4();
      });
    }
    const doEnd = function() {
      self.native.end(function() {
        self._connected = false;
        self._errorAllQueries(new Error("Connection terminated"));
        process.nextTick(() => {
          self.emit("end");
          if (cb)
            cb();
        });
      });
    };
    if (this.pipeline && (this._pipelineInFlight || this._queryQueue.length > 0)) {
      this.once("drain", doEnd);
    } else {
      doEnd();
    }
    return result;
  };
  Client.prototype._hasActiveQuery = function() {
    return this._activeQuery && this._activeQuery.state !== "error" && this._activeQuery.state !== "end";
  };
  Client.prototype._pulseQueryQueue = function(initialConnection) {
    if (!this._connected) {
      return;
    }
    if (this.pipeline && !initialConnection) {
      return this._pulsePipelinedQueryQueue();
    }
    if (this._hasActiveQuery()) {
      return;
    }
    const query = this._queryQueue.shift();
    if (!query) {
      if (!initialConnection) {
        this.emit("drain");
      }
      return;
    }
    this._activeQuery = query;
    query.submit(this);
    const self = this;
    query.once("_done", function() {
      self._pulseQueryQueue();
    });
  };
  Client.prototype._pulsePipelinedQueryQueue = function() {
    if (!this._connected || this._pipelineInFlight) {
      return;
    }
    if (this._queryQueue.length === 0) {
      if (this.hasExecuted) {
        this.emit("drain");
      }
      return;
    }
    this._pipelineInFlight = true;
    const self = this;
    const queries = [];
    const nativeQueries = [];
    const utils = require_utils();
    while (this._queryQueue.length > 0) {
      const query = this._queryQueue.shift();
      this.hasExecuted = true;
      nativeQueries.push(query);
      const values = query.values ? query.values.map(utils.prepareValue) : null;
      const pipelineEntry = { text: query.text, name: query.name };
      if (values) {
        pipelineEntry.values = values;
      }
      if (query.name && this.namedQueries[query.name]) {
        pipelineEntry._alreadyPrepared = true;
      }
      queries.push(pipelineEntry);
    }
    this.native.pipeline(queries, function(err, results) {
      self._pipelineInFlight = false;
      if (err) {
        for (let i = 0;i < nativeQueries.length; i++) {
          const q = nativeQueries[i];
          q.native = self.native;
          q.handleError(err);
        }
        self._pulsePipelinedQueryQueue();
        return;
      }
      for (let i = 0;i < nativeQueries.length; i++) {
        const q = nativeQueries[i];
        const r = results[i];
        q.native = self.native;
        if (r.err) {
          q.handleError(r.err);
        } else {
          if (q.name) {
            self.namedQueries[q.name] = q.text;
          }
          q.state = "end";
          q.emit("end", r.result);
          if (q.callback) {
            q.callback(null, r.result);
          }
        }
        setImmediate(function() {
          q.emit("_done");
        });
      }
      self._pulsePipelinedQueryQueue();
    });
  };
  Client.prototype.cancel = function(query) {
    if (this._activeQuery === query) {
      this.native.cancel(function() {});
    } else if (this._queryQueue.indexOf(query) !== -1) {
      this._queryQueue.splice(this._queryQueue.indexOf(query), 1);
    }
  };
  Client.prototype.ref = function() {};
  Client.prototype.unref = function() {};
  Client.prototype.setTypeParser = function(oid, format, parseFn) {
    return this._types.setTypeParser(oid, format, parseFn);
  };
  Client.prototype.getTypeParser = function(oid, format) {
    return this._types.getTypeParser(oid, format);
  };
  Client.prototype.isConnected = function() {
    return this._connected;
  };
  Client.prototype.getTransactionStatus = function() {
    return this.native.getTransactionStatus();
  };
});

// ../../node_modules/.bun/pg@8.23.0+00a0136bc273dfed/node_modules/pg/lib/index.js
var require_lib2 = __commonJS((exports, module) => {
  var Client = require_client();
  var defaults = require_defaults();
  var Connection = require_connection();
  var Result = require_result();
  var utils = require_utils();
  var Pool = require_pg_pool();
  var TypeOverrides = require_type_overrides();
  var { DatabaseError } = require_dist();
  var { escapeIdentifier, escapeLiteral } = require_utils();
  var poolFactory = (Client2) => {
    return class BoundPool extends Pool {
      constructor(options) {
        super(options, Client2);
      }
    };
  };
  var PG = function(clientConstructor2) {
    this.defaults = defaults;
    this.Client = clientConstructor2;
    this.Query = this.Client.Query;
    this.Pool = poolFactory(this.Client);
    this._pools = [];
    this.Connection = Connection;
    this.types = require_pg_types();
    this.DatabaseError = DatabaseError;
    this.TypeOverrides = TypeOverrides;
    this.escapeIdentifier = escapeIdentifier;
    this.escapeLiteral = escapeLiteral;
    this.Result = Result;
    this.utils = utils;
  };
  var clientConstructor = Client;
  var forceNative = false;
  try {
    forceNative = !!process.env.NODE_PG_FORCE_NATIVE;
  } catch {}
  if (forceNative) {
    clientConstructor = require_client2();
  }
  module.exports = new PG(clientConstructor);
  Object.defineProperty(module.exports, "native", {
    configurable: true,
    enumerable: false,
    get() {
      let native = null;
      try {
        native = new PG(require_client2());
      } catch (err) {
        if (err.code !== "MODULE_NOT_FOUND") {
          throw err;
        }
      }
      Object.defineProperty(module.exports, "native", {
        value: native
      });
      return native;
    }
  });
});

// ../../node_modules/.bun/pg@8.23.0+00a0136bc273dfed/node_modules/pg/esm/index.mjs
var exports_esm = {};
__export(exports_esm, {
  types: () => types2,
  escapeLiteral: () => escapeLiteral,
  escapeIdentifier: () => escapeIdentifier,
  defaults: () => defaults,
  default: () => esm_default,
  TypeOverrides: () => TypeOverrides,
  Result: () => Result,
  Query: () => Query,
  Pool: () => Pool,
  DatabaseError: () => DatabaseError,
  Connection: () => Connection,
  Client: () => Client
});
var import_lib, Client, Pool, Connection, types2, Query, DatabaseError, escapeIdentifier, escapeLiteral, Result, TypeOverrides, defaults, esm_default;
var init_esm = __esm(() => {
  import_lib = __toESM(require_lib2(), 1);
  Client = import_lib.default.Client;
  Pool = import_lib.default.Pool;
  Connection = import_lib.default.Connection;
  types2 = import_lib.default.types;
  Query = import_lib.default.Query;
  DatabaseError = import_lib.default.DatabaseError;
  escapeIdentifier = import_lib.default.escapeIdentifier;
  escapeLiteral = import_lib.default.escapeLiteral;
  Result = import_lib.default.Result;
  TypeOverrides = import_lib.default.TypeOverrides;
  defaults = import_lib.default.defaults;
  esm_default = import_lib.default;
});

// src/cli/index.ts
import { existsSync as existsSync5, readdirSync as readdirSync5, readFileSync as readFileSync9, statSync as statSync5 } from "fs";
import { join as join9 } from "path";

// ../../node_modules/.bun/commander@13.1.0/node_modules/commander/esm.mjs
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

// src/schemas.ts
import { createHash as createHash2 } from "crypto";

// src/todos/common.ts
import { createHash } from "crypto";

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/core.js
var NEVER = Object.freeze({
  status: "aborted"
});
function $constructor(name, initializer, params) {
  function init(inst, def) {
    var _a;
    Object.defineProperty(inst, "_zod", {
      value: inst._zod ?? {},
      enumerable: false
    });
    (_a = inst._zod).traits ?? (_a.traits = new Set);
    inst._zod.traits.add(name);
    initializer(inst, def);
    for (const k in _.prototype) {
      if (!(k in inst))
        Object.defineProperty(inst, k, { value: _.prototype[k].bind(inst) });
    }
    inst._zod.constr = _;
    inst._zod.def = def;
  }
  const Parent = params?.Parent ?? Object;

  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    var _a;
    const inst = params?.Parent ? new Definition : this;
    init(inst, def);
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    for (const fn of inst._zod.deferred) {
      fn();
    }
    return inst;
  }
  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent)
        return true;
      return inst?._zod?.traits?.has(name);
    }
  });
  Object.defineProperty(_, "name", { value: name });
  return _;
}
var $brand = Symbol("zod_brand");

class $ZodAsyncError extends Error {
  constructor() {
    super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
  }
}
var globalConfig = {};
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}
// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/util.js
var exports_util = {};
__export(exports_util, {
  unwrapMessage: () => unwrapMessage,
  stringifyPrimitive: () => stringifyPrimitive,
  required: () => required,
  randomString: () => randomString,
  propertyKeyTypes: () => propertyKeyTypes,
  promiseAllObject: () => promiseAllObject,
  primitiveTypes: () => primitiveTypes,
  prefixIssues: () => prefixIssues,
  pick: () => pick,
  partial: () => partial,
  optionalKeys: () => optionalKeys,
  omit: () => omit,
  numKeys: () => numKeys,
  nullish: () => nullish,
  normalizeParams: () => normalizeParams,
  merge: () => merge,
  jsonStringifyReplacer: () => jsonStringifyReplacer,
  joinValues: () => joinValues,
  issue: () => issue,
  isPlainObject: () => isPlainObject,
  isObject: () => isObject,
  getSizableOrigin: () => getSizableOrigin,
  getParsedType: () => getParsedType,
  getLengthableOrigin: () => getLengthableOrigin,
  getEnumValues: () => getEnumValues,
  getElementAtPath: () => getElementAtPath,
  floatSafeRemainder: () => floatSafeRemainder,
  finalizeIssue: () => finalizeIssue,
  extend: () => extend,
  escapeRegex: () => escapeRegex,
  esc: () => esc,
  defineLazy: () => defineLazy,
  createTransparentProxy: () => createTransparentProxy,
  clone: () => clone,
  cleanRegex: () => cleanRegex,
  cleanEnum: () => cleanEnum,
  captureStackTrace: () => captureStackTrace,
  cached: () => cached,
  assignProp: () => assignProp,
  assertNotEqual: () => assertNotEqual,
  assertNever: () => assertNever,
  assertIs: () => assertIs,
  assertEqual: () => assertEqual,
  assert: () => assert,
  allowsEval: () => allowsEval,
  aborted: () => aborted,
  NUMBER_FORMAT_RANGES: () => NUMBER_FORMAT_RANGES,
  Class: () => Class,
  BIGINT_FORMAT_RANGES: () => BIGINT_FORMAT_RANGES
});
function assertEqual(val) {
  return val;
}
function assertNotEqual(val) {
  return val;
}
function assertIs(_arg) {}
function assertNever(_x) {
  throw new Error;
}
function assert(_) {}
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
function joinValues(array, separator = "|") {
  return array.map((val) => stringifyPrimitive(val)).join(separator);
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}
function cached(getter) {
  const set = false;
  return {
    get value() {
      if (!set) {
        const value = getter();
        Object.defineProperty(this, "value", { value });
        return value;
      }
      throw new Error("cached value already set");
    }
  };
}
function nullish(input) {
  return input === null || input === undefined;
}
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
function defineLazy(object, key, getter) {
  const set = false;
  Object.defineProperty(object, key, {
    get() {
      if (!set) {
        const value = getter();
        object[key] = value;
        return value;
      }
      throw new Error("cached value already set");
    },
    set(v) {
      Object.defineProperty(object, key, {
        value: v
      });
    },
    configurable: true
  });
}
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
function getElementAtPath(obj, path) {
  if (!path)
    return obj;
  return path.reduce((acc, key) => acc?.[key], obj);
}
function promiseAllObject(promisesObj) {
  const keys = Object.keys(promisesObj);
  const promises = keys.map((key) => promisesObj[key]);
  return Promise.all(promises).then((results) => {
    const resolvedObj = {};
    for (let i = 0;i < keys.length; i++) {
      resolvedObj[keys[i]] = results[i];
    }
    return resolvedObj;
  });
}
function randomString(length = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let str = "";
  for (let i = 0;i < length; i++) {
    str += chars[Math.floor(Math.random() * chars.length)];
  }
  return str;
}
function esc(str) {
  return JSON.stringify(str);
}
var captureStackTrace = Error.captureStackTrace ? Error.captureStackTrace : (..._args) => {};
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
var allowsEval = cached(() => {
  if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) {
    return false;
  }
  try {
    const F = Function;
    new F("");
    return true;
  } catch (_) {
    return false;
  }
});
function isPlainObject(o) {
  if (isObject(o) === false)
    return false;
  const ctor = o.constructor;
  if (ctor === undefined)
    return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false)
    return false;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) {
    return false;
  }
  return true;
}
function numKeys(data) {
  let keyCount = 0;
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      keyCount++;
    }
  }
  return keyCount;
}
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return "undefined";
    case "string":
      return "string";
    case "number":
      return Number.isNaN(data) ? "nan" : "number";
    case "boolean":
      return "boolean";
    case "function":
      return "function";
    case "bigint":
      return "bigint";
    case "symbol":
      return "symbol";
    case "object":
      if (Array.isArray(data)) {
        return "array";
      }
      if (data === null) {
        return "null";
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return "promise";
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return "map";
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return "set";
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return "date";
      }
      if (typeof File !== "undefined" && data instanceof File) {
        return "file";
      }
      return "object";
    default:
      throw new Error(`Unknown data type: ${t}`);
  }
};
var propertyKeyTypes = new Set(["string", "number", "symbol"]);
var primitiveTypes = new Set(["string", "number", "bigint", "boolean", "symbol", "undefined"]);
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
  const cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || params?.parent)
    cl._zod.parent = inst;
  return cl;
}
function normalizeParams(_params) {
  const params = _params;
  if (!params)
    return {};
  if (typeof params === "string")
    return { error: () => params };
  if (params?.message !== undefined) {
    if (params?.error !== undefined)
      throw new Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string")
    return { ...params, error: () => params.error };
  return params;
}
function createTransparentProxy(getter) {
  let target;
  return new Proxy({}, {
    get(_, prop, receiver) {
      target ?? (target = getter());
      return Reflect.get(target, prop, receiver);
    },
    set(_, prop, value, receiver) {
      target ?? (target = getter());
      return Reflect.set(target, prop, value, receiver);
    },
    has(_, prop) {
      target ?? (target = getter());
      return Reflect.has(target, prop);
    },
    deleteProperty(_, prop) {
      target ?? (target = getter());
      return Reflect.deleteProperty(target, prop);
    },
    ownKeys(_) {
      target ?? (target = getter());
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(_, prop) {
      target ?? (target = getter());
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    defineProperty(_, prop, descriptor) {
      target ?? (target = getter());
      return Reflect.defineProperty(target, prop, descriptor);
    }
  });
}
function stringifyPrimitive(value) {
  if (typeof value === "bigint")
    return value.toString() + "n";
  if (typeof value === "string")
    return `"${value}"`;
  return `${value}`;
}
function optionalKeys(shape) {
  return Object.keys(shape).filter((k) => {
    return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
  });
}
var NUMBER_FORMAT_RANGES = {
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-340282346638528860000000000000000000000, 340282346638528860000000000000000000000],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
var BIGINT_FORMAT_RANGES = {
  int64: [/* @__PURE__ */ BigInt("-9223372036854775808"), /* @__PURE__ */ BigInt("9223372036854775807")],
  uint64: [/* @__PURE__ */ BigInt(0), /* @__PURE__ */ BigInt("18446744073709551615")]
};
function pick(schema, mask) {
  const newShape = {};
  const currDef = schema._zod.def;
  for (const key in mask) {
    if (!(key in currDef.shape)) {
      throw new Error(`Unrecognized key: "${key}"`);
    }
    if (!mask[key])
      continue;
    newShape[key] = currDef.shape[key];
  }
  return clone(schema, {
    ...schema._zod.def,
    shape: newShape,
    checks: []
  });
}
function omit(schema, mask) {
  const newShape = { ...schema._zod.def.shape };
  const currDef = schema._zod.def;
  for (const key in mask) {
    if (!(key in currDef.shape)) {
      throw new Error(`Unrecognized key: "${key}"`);
    }
    if (!mask[key])
      continue;
    delete newShape[key];
  }
  return clone(schema, {
    ...schema._zod.def,
    shape: newShape,
    checks: []
  });
}
function extend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to extend: expected a plain object");
  }
  const def = {
    ...schema._zod.def,
    get shape() {
      const _shape = { ...schema._zod.def.shape, ...shape };
      assignProp(this, "shape", _shape);
      return _shape;
    },
    checks: []
  };
  return clone(schema, def);
}
function merge(a, b) {
  return clone(a, {
    ...a._zod.def,
    get shape() {
      const _shape = { ...a._zod.def.shape, ...b._zod.def.shape };
      assignProp(this, "shape", _shape);
      return _shape;
    },
    catchall: b._zod.def.catchall,
    checks: []
  });
}
function partial(Class, schema, mask) {
  const oldShape = schema._zod.def.shape;
  const shape = { ...oldShape };
  if (mask) {
    for (const key in mask) {
      if (!(key in oldShape)) {
        throw new Error(`Unrecognized key: "${key}"`);
      }
      if (!mask[key])
        continue;
      shape[key] = Class ? new Class({
        type: "optional",
        innerType: oldShape[key]
      }) : oldShape[key];
    }
  } else {
    for (const key in oldShape) {
      shape[key] = Class ? new Class({
        type: "optional",
        innerType: oldShape[key]
      }) : oldShape[key];
    }
  }
  return clone(schema, {
    ...schema._zod.def,
    shape,
    checks: []
  });
}
function required(Class, schema, mask) {
  const oldShape = schema._zod.def.shape;
  const shape = { ...oldShape };
  if (mask) {
    for (const key in mask) {
      if (!(key in shape)) {
        throw new Error(`Unrecognized key: "${key}"`);
      }
      if (!mask[key])
        continue;
      shape[key] = new Class({
        type: "nonoptional",
        innerType: oldShape[key]
      });
    }
  } else {
    for (const key in oldShape) {
      shape[key] = new Class({
        type: "nonoptional",
        innerType: oldShape[key]
      });
    }
  }
  return clone(schema, {
    ...schema._zod.def,
    shape,
    checks: []
  });
}
function aborted(x, startIndex = 0) {
  for (let i = startIndex;i < x.issues.length; i++) {
    if (x.issues[i]?.continue !== true)
      return true;
  }
  return false;
}
function prefixIssues(path, issues) {
  return issues.map((iss) => {
    var _a;
    (_a = iss).path ?? (_a.path = []);
    iss.path.unshift(path);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function finalizeIssue(iss, ctx, config2) {
  const full = { ...iss, path: iss.path ?? [] };
  if (!iss.message) {
    const message = unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config2.customError?.(iss)) ?? unwrapMessage(config2.localeError?.(iss)) ?? "Invalid input";
    full.message = message;
  }
  delete full.inst;
  delete full.continue;
  if (!ctx?.reportInput) {
    delete full.input;
  }
  return full;
}
function getSizableOrigin(input) {
  if (input instanceof Set)
    return "set";
  if (input instanceof Map)
    return "map";
  if (input instanceof File)
    return "file";
  return "unknown";
}
function getLengthableOrigin(input) {
  if (Array.isArray(input))
    return "array";
  if (typeof input === "string")
    return "string";
  return "unknown";
}
function issue(...args) {
  const [iss, input, inst] = args;
  if (typeof iss === "string") {
    return {
      message: iss,
      code: "custom",
      input,
      inst
    };
  }
  return { ...iss };
}
function cleanEnum(obj) {
  return Object.entries(obj).filter(([k, _]) => {
    return Number.isNaN(Number.parseInt(k, 10));
  }).map((el) => el[1]);
}

class Class {
  constructor(..._args) {}
}

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/errors.js
var initializer = (inst, def) => {
  inst.name = "$ZodError";
  Object.defineProperty(inst, "_zod", {
    value: inst._zod,
    enumerable: false
  });
  Object.defineProperty(inst, "issues", {
    value: def,
    enumerable: false
  });
  Object.defineProperty(inst, "message", {
    get() {
      return JSON.stringify(def, jsonStringifyReplacer, 2);
    },
    enumerable: true
  });
  Object.defineProperty(inst, "toString", {
    value: () => inst.message,
    enumerable: false
  });
};
var $ZodError = $constructor("$ZodError", initializer);
var $ZodRealError = $constructor("$ZodError", initializer, { Parent: Error });
function flattenError(error, mapper = (issue2) => issue2.message) {
  const fieldErrors = {};
  const formErrors = [];
  for (const sub of error.issues) {
    if (sub.path.length > 0) {
      fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
      fieldErrors[sub.path[0]].push(mapper(sub));
    } else {
      formErrors.push(mapper(sub));
    }
  }
  return { formErrors, fieldErrors };
}
function formatError(error, _mapper) {
  const mapper = _mapper || function(issue2) {
    return issue2.message;
  };
  const fieldErrors = { _errors: [] };
  const processError = (error2) => {
    for (const issue2 of error2.issues) {
      if (issue2.code === "invalid_union" && issue2.errors.length) {
        issue2.errors.map((issues) => processError({ issues }));
      } else if (issue2.code === "invalid_key") {
        processError({ issues: issue2.issues });
      } else if (issue2.code === "invalid_element") {
        processError({ issues: issue2.issues });
      } else if (issue2.path.length === 0) {
        fieldErrors._errors.push(mapper(issue2));
      } else {
        let curr = fieldErrors;
        let i = 0;
        while (i < issue2.path.length) {
          const el = issue2.path[i];
          const terminal = i === issue2.path.length - 1;
          if (!terminal) {
            curr[el] = curr[el] || { _errors: [] };
          } else {
            curr[el] = curr[el] || { _errors: [] };
            curr[el]._errors.push(mapper(issue2));
          }
          curr = curr[el];
          i++;
        }
      }
    }
  };
  processError(error);
  return fieldErrors;
}

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/parse.js
var _parse = (_Err) => (schema, value, _ctx, _params) => {
  const ctx = _ctx ? Object.assign(_ctx, { async: false }) : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError;
  }
  if (result.issues.length) {
    const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, _params?.callee);
    throw e;
  }
  return result.value;
};
var _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
  const ctx = _ctx ? Object.assign(_ctx, { async: true }) : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  if (result.issues.length) {
    const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, params?.callee);
    throw e;
  }
  return result.value;
};
var _safeParse = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError;
  }
  return result.issues.length ? {
    success: false,
    error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
};
var safeParse = /* @__PURE__ */ _safeParse($ZodRealError);
var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? Object.assign(_ctx, { async: true }) : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? {
    success: false,
    error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
};
var safeParseAsync = /* @__PURE__ */ _safeParseAsync($ZodRealError);
// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/regexes.js
var cuid = /^[cC][^\s-]{8,}$/;
var cuid2 = /^[0-9a-z]+$/;
var ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
var xid = /^[0-9a-vA-V]{20}$/;
var ksuid = /^[A-Za-z0-9]{27}$/;
var nanoid = /^[a-zA-Z0-9_-]{21}$/;
var duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
var guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
var uuid = (version) => {
  if (!version)
    return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000)$/;
  return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
var email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
var _emoji = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
function emoji() {
  return new RegExp(_emoji, "u");
}
var ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})$/;
var cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
var cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
var base64url = /^[A-Za-z0-9_-]*$/;
var hostname = /^([a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+$/;
var e164 = /^\+(?:[0-9]){6,14}[0-9]$/;
var dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
var date = /* @__PURE__ */ new RegExp(`^${dateSource}$`);
function timeSource(args) {
  const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
  const regex = typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
  return regex;
}
function time(args) {
  return new RegExp(`^${timeSource(args)}$`);
}
function datetime(args) {
  const time2 = timeSource({ precision: args.precision });
  const opts = ["Z"];
  if (args.local)
    opts.push("");
  if (args.offset)
    opts.push(`([+-]\\d{2}:\\d{2})`);
  const timeRegex = `${time2}(?:${opts.join("|")})`;
  return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
var string = (params) => {
  const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
  return new RegExp(`^${regex}$`);
};
var integer = /^\d+$/;
var number = /^-?\d+(?:\.\d+)?/i;
var boolean = /true|false/i;
var _null = /null/i;
var lowercase = /^[^A-Z]*$/;
var uppercase = /^[^a-z]*$/;

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/checks.js
var $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
  var _a;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a = inst._zod).onattach ?? (_a.onattach = []);
});
var numericOriginMap = {
  number: "number",
  bigint: "bigint",
  object: "date"
};
var $ZodCheckLessThan = /* @__PURE__ */ $constructor("$ZodCheckLessThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
    if (def.value < curr) {
      if (def.inclusive)
        bag.maximum = def.value;
      else
        bag.exclusiveMaximum = def.value;
    }
  });
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value <= def.value : payload.value < def.value) {
      return;
    }
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckGreaterThan = /* @__PURE__ */ $constructor("$ZodCheckGreaterThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    const curr = (def.inclusive ? bag.minimum : bag.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
    if (def.value > curr) {
      if (def.inclusive)
        bag.minimum = def.value;
      else
        bag.exclusiveMinimum = def.value;
    }
  });
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value >= def.value : payload.value > def.value) {
      return;
    }
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMultipleOf = /* @__PURE__ */ $constructor("$ZodCheckMultipleOf", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    var _a;
    (_a = inst2._zod.bag).multipleOf ?? (_a.multipleOf = def.value);
  });
  inst._zod.check = (payload) => {
    if (typeof payload.value !== typeof def.value)
      throw new Error("Cannot mix number and bigint in multiple_of check.");
    const isMultiple = typeof payload.value === "bigint" ? payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0;
    if (isMultiple)
      return;
    payload.issues.push({
      origin: typeof payload.value,
      code: "not_multiple_of",
      divisor: def.value,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckNumberFormat = /* @__PURE__ */ $constructor("$ZodCheckNumberFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  def.format = def.format || "float64";
  const isInt = def.format?.includes("int");
  const origin = isInt ? "int" : "number";
  const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = def.format;
    bag.minimum = minimum;
    bag.maximum = maximum;
    if (isInt)
      bag.pattern = integer;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (isInt) {
      if (!Number.isInteger(input)) {
        payload.issues.push({
          expected: origin,
          format: def.format,
          code: "invalid_type",
          input,
          inst
        });
        return;
      }
      if (!Number.isSafeInteger(input)) {
        if (input > 0) {
          payload.issues.push({
            input,
            code: "too_big",
            maximum: Number.MAX_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            continue: !def.abort
          });
        } else {
          payload.issues.push({
            input,
            code: "too_small",
            minimum: Number.MIN_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            continue: !def.abort
          });
        }
        return;
      }
    }
    if (input < minimum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_big",
        maximum,
        inst
      });
    }
  };
});
var $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== undefined;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
    if (def.maximum < curr)
      inst2._zod.bag.maximum = def.maximum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length <= def.maximum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== undefined;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
    if (def.minimum > curr)
      inst2._zod.bag.minimum = def.minimum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length >= def.minimum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLengthEquals = /* @__PURE__ */ $constructor("$ZodCheckLengthEquals", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== undefined;
  });
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.minimum = def.length;
    bag.maximum = def.length;
    bag.length = def.length;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length === def.length)
      return;
    const origin = getLengthableOrigin(input);
    const tooBig = length > def.length;
    payload.issues.push({
      origin,
      ...tooBig ? { code: "too_big", maximum: def.length } : { code: "too_small", minimum: def.length },
      inclusive: true,
      exact: true,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStringFormat = /* @__PURE__ */ $constructor("$ZodCheckStringFormat", (inst, def) => {
  var _a, _b;
  $ZodCheck.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = def.format;
    if (def.pattern) {
      bag.patterns ?? (bag.patterns = new Set);
      bag.patterns.add(def.pattern);
    }
  });
  if (def.pattern)
    (_a = inst._zod).check ?? (_a.check = (payload) => {
      def.pattern.lastIndex = 0;
      if (def.pattern.test(payload.value))
        return;
      payload.issues.push({
        origin: "string",
        code: "invalid_format",
        format: def.format,
        input: payload.value,
        ...def.pattern ? { pattern: def.pattern.toString() } : {},
        inst,
        continue: !def.abort
      });
    });
  else
    (_b = inst._zod).check ?? (_b.check = () => {});
});
var $ZodCheckRegex = /* @__PURE__ */ $constructor("$ZodCheckRegex", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    def.pattern.lastIndex = 0;
    if (def.pattern.test(payload.value))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: payload.value,
      pattern: def.pattern.toString(),
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLowerCase = /* @__PURE__ */ $constructor("$ZodCheckLowerCase", (inst, def) => {
  def.pattern ?? (def.pattern = lowercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckUpperCase = /* @__PURE__ */ $constructor("$ZodCheckUpperCase", (inst, def) => {
  def.pattern ?? (def.pattern = uppercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckIncludes = /* @__PURE__ */ $constructor("$ZodCheckIncludes", (inst, def) => {
  $ZodCheck.init(inst, def);
  const escapedRegex = escapeRegex(def.includes);
  const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
  def.pattern = pattern;
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.patterns ?? (bag.patterns = new Set);
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.includes(def.includes, def.position))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "includes",
      includes: def.includes,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStartsWith = /* @__PURE__ */ $constructor("$ZodCheckStartsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.patterns ?? (bag.patterns = new Set);
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.startsWith(def.prefix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "starts_with",
      prefix: def.prefix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckEndsWith = /* @__PURE__ */ $constructor("$ZodCheckEndsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.patterns ?? (bag.patterns = new Set);
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.endsWith(def.suffix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "ends_with",
      suffix: def.suffix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckOverwrite = /* @__PURE__ */ $constructor("$ZodCheckOverwrite", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    payload.value = def.tx(payload.value);
  };
});

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/doc.js
class Doc {
  constructor(args = []) {
    this.content = [];
    this.indent = 0;
    if (this)
      this.args = args;
  }
  indented(fn) {
    this.indent += 1;
    fn(this);
    this.indent -= 1;
  }
  write(arg) {
    if (typeof arg === "function") {
      arg(this, { execution: "sync" });
      arg(this, { execution: "async" });
      return;
    }
    const content = arg;
    const lines = content.split(`
`).filter((x) => x);
    const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
    const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
    for (const line of dedented) {
      this.content.push(line);
    }
  }
  compile() {
    const F = Function;
    const args = this?.args;
    const content = this?.content ?? [``];
    const lines = [...content.map((x) => `  ${x}`)];
    return new F(...args, lines.join(`
`));
  }
}

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/versions.js
var version = {
  major: 4,
  minor: 0,
  patch: 0
};

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/schemas.js
var $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
  var _a;
  inst ?? (inst = {});
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.version = version;
  const checks = [...inst._zod.def.checks ?? []];
  if (inst._zod.traits.has("$ZodCheck")) {
    checks.unshift(inst);
  }
  for (const ch of checks) {
    for (const fn of ch._zod.onattach) {
      fn(inst);
    }
  }
  if (checks.length === 0) {
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    inst._zod.deferred?.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    const runChecks = (payload, checks2, ctx) => {
      let isAborted = aborted(payload);
      let asyncResult;
      for (const ch of checks2) {
        if (ch._zod.def.when) {
          const shouldRun = ch._zod.def.when(payload);
          if (!shouldRun)
            continue;
        } else if (isAborted) {
          continue;
        }
        const currLen = payload.issues.length;
        const _ = ch._zod.check(payload);
        if (_ instanceof Promise && ctx?.async === false) {
          throw new $ZodAsyncError;
        }
        if (asyncResult || _ instanceof Promise) {
          asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
            await _;
            const nextLen = payload.issues.length;
            if (nextLen === currLen)
              return;
            if (!isAborted)
              isAborted = aborted(payload, currLen);
          });
        } else {
          const nextLen = payload.issues.length;
          if (nextLen === currLen)
            continue;
          if (!isAborted)
            isAborted = aborted(payload, currLen);
        }
      }
      if (asyncResult) {
        return asyncResult.then(() => {
          return payload;
        });
      }
      return payload;
    };
    inst._zod.run = (payload, ctx) => {
      const result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError;
        return result.then((result2) => runChecks(result2, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }
  inst["~standard"] = {
    validate: (value) => {
      try {
        const r = safeParse(inst, value);
        return r.success ? { value: r.data } : { issues: r.error?.issues };
      } catch (_) {
        return safeParseAsync(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
      }
    },
    vendor: "zod",
    version: 1
  };
});
var $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string(inst._zod.bag);
  inst._zod.parse = (payload, _) => {
    if (def.coerce)
      try {
        payload.value = String(payload.value);
      } catch (_2) {}
    if (typeof payload.value === "string")
      return payload;
    payload.issues.push({
      expected: "string",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodStringFormat = /* @__PURE__ */ $constructor("$ZodStringFormat", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  $ZodString.init(inst, def);
});
var $ZodGUID = /* @__PURE__ */ $constructor("$ZodGUID", (inst, def) => {
  def.pattern ?? (def.pattern = guid);
  $ZodStringFormat.init(inst, def);
});
var $ZodUUID = /* @__PURE__ */ $constructor("$ZodUUID", (inst, def) => {
  if (def.version) {
    const versionMap = {
      v1: 1,
      v2: 2,
      v3: 3,
      v4: 4,
      v5: 5,
      v6: 6,
      v7: 7,
      v8: 8
    };
    const v = versionMap[def.version];
    if (v === undefined)
      throw new Error(`Invalid UUID version: "${def.version}"`);
    def.pattern ?? (def.pattern = uuid(v));
  } else
    def.pattern ?? (def.pattern = uuid());
  $ZodStringFormat.init(inst, def);
});
var $ZodEmail = /* @__PURE__ */ $constructor("$ZodEmail", (inst, def) => {
  def.pattern ?? (def.pattern = email);
  $ZodStringFormat.init(inst, def);
});
var $ZodURL = /* @__PURE__ */ $constructor("$ZodURL", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    try {
      const orig = payload.value;
      const url = new URL(orig);
      const href = url.href;
      if (def.hostname) {
        def.hostname.lastIndex = 0;
        if (!def.hostname.test(url.hostname)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid hostname",
            pattern: hostname.source,
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      }
      if (def.protocol) {
        def.protocol.lastIndex = 0;
        if (!def.protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid protocol",
            pattern: def.protocol.source,
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      }
      if (!orig.endsWith("/") && href.endsWith("/")) {
        payload.value = href.slice(0, -1);
      } else {
        payload.value = href;
      }
      return;
    } catch (_) {
      payload.issues.push({
        code: "invalid_format",
        format: "url",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodEmoji = /* @__PURE__ */ $constructor("$ZodEmoji", (inst, def) => {
  def.pattern ?? (def.pattern = emoji());
  $ZodStringFormat.init(inst, def);
});
var $ZodNanoID = /* @__PURE__ */ $constructor("$ZodNanoID", (inst, def) => {
  def.pattern ?? (def.pattern = nanoid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID = /* @__PURE__ */ $constructor("$ZodCUID", (inst, def) => {
  def.pattern ?? (def.pattern = cuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID2 = /* @__PURE__ */ $constructor("$ZodCUID2", (inst, def) => {
  def.pattern ?? (def.pattern = cuid2);
  $ZodStringFormat.init(inst, def);
});
var $ZodULID = /* @__PURE__ */ $constructor("$ZodULID", (inst, def) => {
  def.pattern ?? (def.pattern = ulid);
  $ZodStringFormat.init(inst, def);
});
var $ZodXID = /* @__PURE__ */ $constructor("$ZodXID", (inst, def) => {
  def.pattern ?? (def.pattern = xid);
  $ZodStringFormat.init(inst, def);
});
var $ZodKSUID = /* @__PURE__ */ $constructor("$ZodKSUID", (inst, def) => {
  def.pattern ?? (def.pattern = ksuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodISODateTime = /* @__PURE__ */ $constructor("$ZodISODateTime", (inst, def) => {
  def.pattern ?? (def.pattern = datetime(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODate = /* @__PURE__ */ $constructor("$ZodISODate", (inst, def) => {
  def.pattern ?? (def.pattern = date);
  $ZodStringFormat.init(inst, def);
});
var $ZodISOTime = /* @__PURE__ */ $constructor("$ZodISOTime", (inst, def) => {
  def.pattern ?? (def.pattern = time(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODuration = /* @__PURE__ */ $constructor("$ZodISODuration", (inst, def) => {
  def.pattern ?? (def.pattern = duration);
  $ZodStringFormat.init(inst, def);
});
var $ZodIPv4 = /* @__PURE__ */ $constructor("$ZodIPv4", (inst, def) => {
  def.pattern ?? (def.pattern = ipv4);
  $ZodStringFormat.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = `ipv4`;
  });
});
var $ZodIPv6 = /* @__PURE__ */ $constructor("$ZodIPv6", (inst, def) => {
  def.pattern ?? (def.pattern = ipv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = `ipv6`;
  });
  inst._zod.check = (payload) => {
    try {
      new URL(`http://[${payload.value}]`);
    } catch {
      payload.issues.push({
        code: "invalid_format",
        format: "ipv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCIDRv4 = /* @__PURE__ */ $constructor("$ZodCIDRv4", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv4);
  $ZodStringFormat.init(inst, def);
});
var $ZodCIDRv6 = /* @__PURE__ */ $constructor("$ZodCIDRv6", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    const [address, prefix] = payload.value.split("/");
    try {
      if (!prefix)
        throw new Error;
      const prefixNum = Number(prefix);
      if (`${prefixNum}` !== prefix)
        throw new Error;
      if (prefixNum < 0 || prefixNum > 128)
        throw new Error;
      new URL(`http://[${address}]`);
    } catch {
      payload.issues.push({
        code: "invalid_format",
        format: "cidrv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
function isValidBase64(data) {
  if (data === "")
    return true;
  if (data.length % 4 !== 0)
    return false;
  try {
    atob(data);
    return true;
  } catch {
    return false;
  }
}
var $ZodBase64 = /* @__PURE__ */ $constructor("$ZodBase64", (inst, def) => {
  def.pattern ?? (def.pattern = base64);
  $ZodStringFormat.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    inst2._zod.bag.contentEncoding = "base64";
  });
  inst._zod.check = (payload) => {
    if (isValidBase64(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
function isValidBase64URL(data) {
  if (!base64url.test(data))
    return false;
  const base642 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
  const padded = base642.padEnd(Math.ceil(base642.length / 4) * 4, "=");
  return isValidBase64(padded);
}
var $ZodBase64URL = /* @__PURE__ */ $constructor("$ZodBase64URL", (inst, def) => {
  def.pattern ?? (def.pattern = base64url);
  $ZodStringFormat.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    inst2._zod.bag.contentEncoding = "base64url";
  });
  inst._zod.check = (payload) => {
    if (isValidBase64URL(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64url",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodE164 = /* @__PURE__ */ $constructor("$ZodE164", (inst, def) => {
  def.pattern ?? (def.pattern = e164);
  $ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
  try {
    const tokensParts = token.split(".");
    if (tokensParts.length !== 3)
      return false;
    const [header] = tokensParts;
    if (!header)
      return false;
    const parsedHeader = JSON.parse(atob(header));
    if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT")
      return false;
    if (!parsedHeader.alg)
      return false;
    if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm))
      return false;
    return true;
  } catch {
    return false;
  }
}
var $ZodJWT = /* @__PURE__ */ $constructor("$ZodJWT", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidJWT(payload.value, def.alg))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "jwt",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = inst._zod.bag.pattern ?? number;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Number(payload.value);
      } catch (_) {}
    const input = payload.value;
    if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) {
      return payload;
    }
    const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? "Infinity" : undefined : undefined;
    payload.issues.push({
      expected: "number",
      code: "invalid_type",
      input,
      inst,
      ...received ? { received } : {}
    });
    return payload;
  };
});
var $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodCheckNumberFormat.init(inst, def);
  $ZodNumber.init(inst, def);
});
var $ZodBoolean = /* @__PURE__ */ $constructor("$ZodBoolean", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = boolean;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Boolean(payload.value);
      } catch (_) {}
    const input = payload.value;
    if (typeof input === "boolean")
      return payload;
    payload.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodNull = /* @__PURE__ */ $constructor("$ZodNull", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = _null;
  inst._zod.values = new Set([null]);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (input === null)
      return payload;
    payload.issues.push({
      expected: "null",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
var $ZodNever = /* @__PURE__ */ $constructor("$ZodNever", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    payload.issues.push({
      expected: "never",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
function handleArrayResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
var $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        expected: "array",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = Array(input.length);
    const proms = [];
    for (let i = 0;i < input.length; i++) {
      const item = input[i];
      const result = def.element._zod.run({
        value: item,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result2) => handleArrayResult(result2, payload, i)));
      } else {
        handleArrayResult(result, payload, i);
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
function handleObjectResult(result, final, key) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(key, result.issues));
  }
  final.value[key] = result.value;
}
function handleOptionalObjectResult(result, final, key, input) {
  if (result.issues.length) {
    if (input[key] === undefined) {
      if (key in input) {
        final.value[key] = undefined;
      } else {
        final.value[key] = result.value;
      }
    } else {
      final.issues.push(...prefixIssues(key, result.issues));
    }
  } else if (result.value === undefined) {
    if (key in input)
      final.value[key] = undefined;
  } else {
    final.value[key] = result.value;
  }
}
var $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
  $ZodType.init(inst, def);
  const _normalized = cached(() => {
    const keys = Object.keys(def.shape);
    for (const k of keys) {
      if (!(def.shape[k] instanceof $ZodType)) {
        throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
      }
    }
    const okeys = optionalKeys(def.shape);
    return {
      shape: def.shape,
      keys,
      keySet: new Set(keys),
      numKeys: keys.length,
      optionalKeys: new Set(okeys)
    };
  });
  defineLazy(inst._zod, "propValues", () => {
    const shape = def.shape;
    const propValues = {};
    for (const key in shape) {
      const field = shape[key]._zod;
      if (field.values) {
        propValues[key] ?? (propValues[key] = new Set);
        for (const v of field.values)
          propValues[key].add(v);
      }
    }
    return propValues;
  });
  const generateFastpass = (shape) => {
    const doc = new Doc(["shape", "payload", "ctx"]);
    const normalized = _normalized.value;
    const parseStr = (key) => {
      const k = esc(key);
      return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
    };
    doc.write(`const input = payload.value;`);
    const ids = Object.create(null);
    let counter = 0;
    for (const key of normalized.keys) {
      ids[key] = `key_${counter++}`;
    }
    doc.write(`const newResult = {}`);
    for (const key of normalized.keys) {
      if (normalized.optionalKeys.has(key)) {
        const id = ids[key];
        doc.write(`const ${id} = ${parseStr(key)};`);
        const k = esc(key);
        doc.write(`
        if (${id}.issues.length) {
          if (input[${k}] === undefined) {
            if (${k} in input) {
              newResult[${k}] = undefined;
            }
          } else {
            payload.issues = payload.issues.concat(
              ${id}.issues.map((iss) => ({
                ...iss,
                path: iss.path ? [${k}, ...iss.path] : [${k}],
              }))
            );
          }
        } else if (${id}.value === undefined) {
          if (${k} in input) newResult[${k}] = undefined;
        } else {
          newResult[${k}] = ${id}.value;
        }
        `);
      } else {
        const id = ids[key];
        doc.write(`const ${id} = ${parseStr(key)};`);
        doc.write(`
          if (${id}.issues.length) payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${esc(key)}, ...iss.path] : [${esc(key)}]
          })));`);
        doc.write(`newResult[${esc(key)}] = ${id}.value`);
      }
    }
    doc.write(`payload.value = newResult;`);
    doc.write(`return payload;`);
    const fn = doc.compile();
    return (payload, ctx) => fn(shape, payload, ctx);
  };
  let fastpass;
  const isObject2 = isObject;
  const jit = !globalConfig.jitless;
  const allowsEval2 = allowsEval;
  const fastEnabled = jit && allowsEval2.value;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    const proms = [];
    if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
      if (!fastpass)
        fastpass = generateFastpass(def.shape);
      payload = fastpass(payload, ctx);
    } else {
      payload.value = {};
      const shape = value.shape;
      for (const key of value.keys) {
        const el = shape[key];
        const r = el._zod.run({ value: input[key], issues: [] }, ctx);
        const isOptional = el._zod.optin === "optional" && el._zod.optout === "optional";
        if (r instanceof Promise) {
          proms.push(r.then((r2) => isOptional ? handleOptionalObjectResult(r2, payload, key, input) : handleObjectResult(r2, payload, key)));
        } else if (isOptional) {
          handleOptionalObjectResult(r, payload, key, input);
        } else {
          handleObjectResult(r, payload, key);
        }
      }
    }
    if (!catchall) {
      return proms.length ? Promise.all(proms).then(() => payload) : payload;
    }
    const unrecognized = [];
    const keySet = value.keySet;
    const _catchall = catchall._zod;
    const t = _catchall.def.type;
    for (const key of Object.keys(input)) {
      if (keySet.has(key))
        continue;
      if (t === "never") {
        unrecognized.push(key);
        continue;
      }
      const r = _catchall.run({ value: input[key], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((r2) => handleObjectResult(r2, payload, key)));
      } else {
        handleObjectResult(r, payload, key);
      }
    }
    if (unrecognized.length) {
      payload.issues.push({
        code: "unrecognized_keys",
        keys: unrecognized,
        input,
        inst
      });
    }
    if (!proms.length)
      return payload;
    return Promise.all(proms).then(() => {
      return payload;
    });
  };
});
function handleUnionResults(results, final, inst, ctx) {
  for (const result of results) {
    if (result.issues.length === 0) {
      final.value = result.value;
      return final;
    }
  }
  final.issues.push({
    code: "invalid_union",
    input: final.value,
    inst,
    errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  });
  return final;
}
var $ZodUnion = /* @__PURE__ */ $constructor("$ZodUnion", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : undefined);
  defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : undefined);
  defineLazy(inst._zod, "values", () => {
    if (def.options.every((o) => o._zod.values)) {
      return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
    }
    return;
  });
  defineLazy(inst._zod, "pattern", () => {
    if (def.options.every((o) => o._zod.pattern)) {
      const patterns = def.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
    }
    return;
  });
  inst._zod.parse = (payload, ctx) => {
    let async = false;
    const results = [];
    for (const option of def.options) {
      const result = option._zod.run({
        value: payload.value,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        results.push(result);
        async = true;
      } else {
        if (result.issues.length === 0)
          return result;
        results.push(result);
      }
    }
    if (!async)
      return handleUnionResults(results, payload, inst, ctx);
    return Promise.all(results).then((results2) => {
      return handleUnionResults(results2, payload, inst, ctx);
    });
  };
});
var $ZodIntersection = /* @__PURE__ */ $constructor("$ZodIntersection", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    const left = def.left._zod.run({ value: input, issues: [] }, ctx);
    const right = def.right._zod.run({ value: input, issues: [] }, ctx);
    const async = left instanceof Promise || right instanceof Promise;
    if (async) {
      return Promise.all([left, right]).then(([left2, right2]) => {
        return handleIntersectionResults(payload, left2, right2);
      });
    }
    return handleIntersectionResults(payload, left, right);
  };
});
function mergeValues(a, b) {
  if (a === b) {
    return { valid: true, data: a };
  }
  if (a instanceof Date && b instanceof Date && +a === +b) {
    return { valid: true, data: a };
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const bKeys = Object.keys(b);
    const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
        };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return { valid: false, mergeErrorPath: [] };
    }
    const newArray = [];
    for (let index = 0;index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
        };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  }
  return { valid: false, mergeErrorPath: [] };
}
function handleIntersectionResults(result, left, right) {
  if (left.issues.length) {
    result.issues.push(...left.issues);
  }
  if (right.issues.length) {
    result.issues.push(...right.issues);
  }
  if (aborted(result))
    return result;
  const merged = mergeValues(left.value, right.value);
  if (!merged.valid) {
    throw new Error(`Unmergable intersection. Error path: ` + `${JSON.stringify(merged.mergeErrorPath)}`);
  }
  result.value = merged.data;
  return result;
}
var $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
  $ZodType.init(inst, def);
  const values = getEnumValues(def.entries);
  inst._zod.values = new Set(values);
  inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (inst._zod.values.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodLiteral = /* @__PURE__ */ $constructor("$ZodLiteral", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.values = new Set(def.values);
  inst._zod.pattern = new RegExp(`^(${def.values.map((o) => typeof o === "string" ? escapeRegex(o) : o ? o.toString() : String(o)).join("|")})$`);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (inst._zod.values.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values: def.values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    const _out = def.transform(payload.value, payload);
    if (_ctx.async) {
      const output = _out instanceof Promise ? _out : Promise.resolve(_out);
      return output.then((output2) => {
        payload.value = output2;
        return payload;
      });
    }
    if (_out instanceof Promise) {
      throw new $ZodAsyncError;
    }
    payload.value = _out;
    return payload;
  };
});
var $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  inst._zod.optout = "optional";
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values ? new Set([...def.innerType._zod.values, undefined]) : undefined;
  });
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    if (def.innerType._zod.optin === "optional") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === undefined) {
      return payload;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : undefined;
  });
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values ? new Set([...def.innerType._zod.values, null]) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === null)
      return payload;
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodDefault = /* @__PURE__ */ $constructor("$ZodDefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === undefined) {
      payload.value = def.defaultValue;
      return payload;
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleDefaultResult(result2, def));
    }
    return handleDefaultResult(result, def);
  };
});
function handleDefaultResult(payload, def) {
  if (payload.value === undefined) {
    payload.value = def.defaultValue;
  }
  return payload;
}
var $ZodPrefault = /* @__PURE__ */ $constructor("$ZodPrefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === undefined) {
      payload.value = def.defaultValue;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNonOptional = /* @__PURE__ */ $constructor("$ZodNonOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => {
    const v = def.innerType._zod.values;
    return v ? new Set([...v].filter((x) => x !== undefined)) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleNonOptionalResult(result2, inst));
    }
    return handleNonOptionalResult(result, inst);
  };
});
function handleNonOptionalResult(payload, inst) {
  if (!payload.issues.length && payload.value === undefined) {
    payload.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: payload.value,
      inst
    });
  }
  return payload;
}
var $ZodCatch = /* @__PURE__ */ $constructor("$ZodCatch", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => {
        payload.value = result2.value;
        if (result2.issues.length) {
          payload.value = def.catchValue({
            ...payload,
            error: {
              issues: result2.issues.map((iss) => finalizeIssue(iss, ctx, config()))
            },
            input: payload.value
          });
          payload.issues = [];
        }
        return payload;
      });
    }
    payload.value = result.value;
    if (result.issues.length) {
      payload.value = def.catchValue({
        ...payload,
        error: {
          issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
        },
        input: payload.value
      });
      payload.issues = [];
    }
    return payload;
  };
});
var $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => def.in._zod.values);
  defineLazy(inst._zod, "optin", () => def.in._zod.optin);
  defineLazy(inst._zod, "optout", () => def.out._zod.optout);
  inst._zod.parse = (payload, ctx) => {
    const left = def.in._zod.run(payload, ctx);
    if (left instanceof Promise) {
      return left.then((left2) => handlePipeResult(left2, def, ctx));
    }
    return handlePipeResult(left, def, ctx);
  };
});
function handlePipeResult(left, def, ctx) {
  if (aborted(left)) {
    return left;
  }
  return def.out._zod.run({ value: left.value, issues: left.issues }, ctx);
}
var $ZodReadonly = /* @__PURE__ */ $constructor("$ZodReadonly", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then(handleReadonlyResult);
    }
    return handleReadonlyResult(result);
  };
});
function handleReadonlyResult(payload) {
  payload.value = Object.freeze(payload.value);
  return payload;
}
var $ZodCustom = /* @__PURE__ */ $constructor("$ZodCustom", (inst, def) => {
  $ZodCheck.init(inst, def);
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _) => {
    return payload;
  };
  inst._zod.check = (payload) => {
    const input = payload.value;
    const r = def.fn(input);
    if (r instanceof Promise) {
      return r.then((r2) => handleRefineResult(r2, payload, input, inst));
    }
    handleRefineResult(r, payload, input, inst);
    return;
  };
});
function handleRefineResult(result, payload, input, inst) {
  if (!result) {
    const _iss = {
      code: "custom",
      input,
      inst,
      path: [...inst._zod.def.path ?? []],
      continue: !inst._zod.def.abort
    };
    if (inst._zod.def.params)
      _iss.params = inst._zod.def.params;
    payload.issues.push(issue(_iss));
  }
}
// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/locales/en.js
var parsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "number": {
      return Number.isNaN(data) ? "NaN" : "number";
    }
    case "object": {
      if (Array.isArray(data)) {
        return "array";
      }
      if (data === null) {
        return "null";
      }
      if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
        return data.constructor.name;
      }
    }
  }
  return t;
};
var error = () => {
  const Sizable = {
    string: { unit: "characters", verb: "to have" },
    file: { unit: "bytes", verb: "to have" },
    array: { unit: "items", verb: "to have" },
    set: { unit: "items", verb: "to have" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const Nouns = {
    regex: "input",
    email: "email address",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datetime",
    date: "ISO date",
    time: "ISO time",
    duration: "ISO duration",
    ipv4: "IPv4 address",
    ipv6: "IPv6 address",
    cidrv4: "IPv4 range",
    cidrv6: "IPv6 range",
    base64: "base64-encoded string",
    base64url: "base64url-encoded string",
    json_string: "JSON string",
    e164: "E.164 number",
    jwt: "JWT",
    template_literal: "input"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Invalid input: expected ${issue2.expected}, received ${parsedType(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Invalid input: expected ${stringifyPrimitive(issue2.values[0])}`;
        return `Invalid option: expected one of ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Too big: expected ${issue2.origin ?? "value"} to have ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elements"}`;
        return `Too big: expected ${issue2.origin ?? "value"} to be ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Too small: expected ${issue2.origin} to have ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Too small: expected ${issue2.origin} to be ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Invalid string: must start with "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Invalid string: must end with "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Invalid string: must include "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Invalid string: must match pattern ${_issue.pattern}`;
        return `Invalid ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Invalid number: must be a multiple of ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Unrecognized key${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Invalid key in ${issue2.origin}`;
      case "invalid_union":
        return "Invalid input";
      case "invalid_element":
        return `Invalid value in ${issue2.origin}`;
      default:
        return `Invalid input`;
    }
  };
};
function en_default() {
  return {
    localeError: error()
  };
}
// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/registries.js
var $output = Symbol("ZodOutput");
var $input = Symbol("ZodInput");

class $ZodRegistry {
  constructor() {
    this._map = new Map;
    this._idmap = new Map;
  }
  add(schema, ..._meta) {
    const meta = _meta[0];
    this._map.set(schema, meta);
    if (meta && typeof meta === "object" && "id" in meta) {
      if (this._idmap.has(meta.id)) {
        throw new Error(`ID ${meta.id} already exists in the registry`);
      }
      this._idmap.set(meta.id, schema);
    }
    return this;
  }
  clear() {
    this._map = new Map;
    this._idmap = new Map;
    return this;
  }
  remove(schema) {
    const meta = this._map.get(schema);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.delete(meta.id);
    }
    this._map.delete(schema);
    return this;
  }
  get(schema) {
    const p = schema._zod.parent;
    if (p) {
      const pm = { ...this.get(p) ?? {} };
      delete pm.id;
      return { ...pm, ...this._map.get(schema) };
    }
    return this._map.get(schema);
  }
  has(schema) {
    return this._map.has(schema);
  }
}
function registry() {
  return new $ZodRegistry;
}
var globalRegistry = /* @__PURE__ */ registry();
// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/core/api.js
function _string(Class2, params) {
  return new Class2({
    type: "string",
    ...normalizeParams(params)
  });
}
function _email(Class2, params) {
  return new Class2({
    type: "string",
    format: "email",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _guid(Class2, params) {
  return new Class2({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _uuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _uuidv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v4",
    ...normalizeParams(params)
  });
}
function _uuidv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v6",
    ...normalizeParams(params)
  });
}
function _uuidv7(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v7",
    ...normalizeParams(params)
  });
}
function _url(Class2, params) {
  return new Class2({
    type: "string",
    format: "url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _emoji2(Class2, params) {
  return new Class2({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _nanoid(Class2, params) {
  return new Class2({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cuid2(Class2, params) {
  return new Class2({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ulid(Class2, params) {
  return new Class2({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _xid(Class2, params) {
  return new Class2({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ksuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ipv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ipv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cidrv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cidrv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _base64(Class2, params) {
  return new Class2({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _base64url(Class2, params) {
  return new Class2({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _e164(Class2, params) {
  return new Class2({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _jwt(Class2, params) {
  return new Class2({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _isoDateTime(Class2, params) {
  return new Class2({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: false,
    local: false,
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDate(Class2, params) {
  return new Class2({
    type: "string",
    format: "date",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _isoTime(Class2, params) {
  return new Class2({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDuration(Class2, params) {
  return new Class2({
    type: "string",
    format: "duration",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _number(Class2, params) {
  return new Class2({
    type: "number",
    checks: [],
    ...normalizeParams(params)
  });
}
function _int(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...normalizeParams(params)
  });
}
function _boolean(Class2, params) {
  return new Class2({
    type: "boolean",
    ...normalizeParams(params)
  });
}
function _null2(Class2, params) {
  return new Class2({
    type: "null",
    ...normalizeParams(params)
  });
}
function _unknown(Class2) {
  return new Class2({
    type: "unknown"
  });
}
function _never(Class2, params) {
  return new Class2({
    type: "never",
    ...normalizeParams(params)
  });
}
function _lt(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
function _lte(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
function _gt(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
function _gte(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
function _multipleOf(value, params) {
  return new $ZodCheckMultipleOf({
    check: "multiple_of",
    ...normalizeParams(params),
    value
  });
}
function _maxLength(maximum, params) {
  const ch = new $ZodCheckMaxLength({
    check: "max_length",
    ...normalizeParams(params),
    maximum
  });
  return ch;
}
function _minLength(minimum, params) {
  return new $ZodCheckMinLength({
    check: "min_length",
    ...normalizeParams(params),
    minimum
  });
}
function _length(length, params) {
  return new $ZodCheckLengthEquals({
    check: "length_equals",
    ...normalizeParams(params),
    length
  });
}
function _regex(pattern, params) {
  return new $ZodCheckRegex({
    check: "string_format",
    format: "regex",
    ...normalizeParams(params),
    pattern
  });
}
function _lowercase(params) {
  return new $ZodCheckLowerCase({
    check: "string_format",
    format: "lowercase",
    ...normalizeParams(params)
  });
}
function _uppercase(params) {
  return new $ZodCheckUpperCase({
    check: "string_format",
    format: "uppercase",
    ...normalizeParams(params)
  });
}
function _includes(includes, params) {
  return new $ZodCheckIncludes({
    check: "string_format",
    format: "includes",
    ...normalizeParams(params),
    includes
  });
}
function _startsWith(prefix, params) {
  return new $ZodCheckStartsWith({
    check: "string_format",
    format: "starts_with",
    ...normalizeParams(params),
    prefix
  });
}
function _endsWith(suffix, params) {
  return new $ZodCheckEndsWith({
    check: "string_format",
    format: "ends_with",
    ...normalizeParams(params),
    suffix
  });
}
function _overwrite(tx) {
  return new $ZodCheckOverwrite({
    check: "overwrite",
    tx
  });
}
function _normalize(form) {
  return _overwrite((input) => input.normalize(form));
}
function _trim() {
  return _overwrite((input) => input.trim());
}
function _toLowerCase() {
  return _overwrite((input) => input.toLowerCase());
}
function _toUpperCase() {
  return _overwrite((input) => input.toUpperCase());
}
function _array(Class2, element, params) {
  return new Class2({
    type: "array",
    element,
    ...normalizeParams(params)
  });
}
function _refine(Class2, fn, _params) {
  const schema = new Class2({
    type: "custom",
    check: "custom",
    fn,
    ...normalizeParams(_params)
  });
  return schema;
}
// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/classic/iso.js
var exports_iso = {};
__export(exports_iso, {
  time: () => time2,
  duration: () => duration2,
  datetime: () => datetime2,
  date: () => date2,
  ZodISOTime: () => ZodISOTime,
  ZodISODuration: () => ZodISODuration,
  ZodISODateTime: () => ZodISODateTime,
  ZodISODate: () => ZodISODate
});
var ZodISODateTime = /* @__PURE__ */ $constructor("ZodISODateTime", (inst, def) => {
  $ZodISODateTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function datetime2(params) {
  return _isoDateTime(ZodISODateTime, params);
}
var ZodISODate = /* @__PURE__ */ $constructor("ZodISODate", (inst, def) => {
  $ZodISODate.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function date2(params) {
  return _isoDate(ZodISODate, params);
}
var ZodISOTime = /* @__PURE__ */ $constructor("ZodISOTime", (inst, def) => {
  $ZodISOTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function time2(params) {
  return _isoTime(ZodISOTime, params);
}
var ZodISODuration = /* @__PURE__ */ $constructor("ZodISODuration", (inst, def) => {
  $ZodISODuration.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function duration2(params) {
  return _isoDuration(ZodISODuration, params);
}

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/classic/errors.js
var initializer2 = (inst, issues) => {
  $ZodError.init(inst, issues);
  inst.name = "ZodError";
  Object.defineProperties(inst, {
    format: {
      value: (mapper) => formatError(inst, mapper)
    },
    flatten: {
      value: (mapper) => flattenError(inst, mapper)
    },
    addIssue: {
      value: (issue2) => inst.issues.push(issue2)
    },
    addIssues: {
      value: (issues2) => inst.issues.push(...issues2)
    },
    isEmpty: {
      get() {
        return inst.issues.length === 0;
      }
    }
  });
};
var ZodError = $constructor("ZodError", initializer2);
var ZodRealError = $constructor("ZodError", initializer2, {
  Parent: Error
});

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/classic/parse.js
var parse2 = /* @__PURE__ */ _parse(ZodRealError);
var parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
var safeParse2 = /* @__PURE__ */ _safeParse(ZodRealError);
var safeParseAsync2 = /* @__PURE__ */ _safeParseAsync(ZodRealError);

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/classic/schemas.js
var ZodType = /* @__PURE__ */ $constructor("ZodType", (inst, def) => {
  $ZodType.init(inst, def);
  inst.def = def;
  Object.defineProperty(inst, "_def", { value: def });
  inst.check = (...checks2) => {
    return inst.clone({
      ...def,
      checks: [
        ...def.checks ?? [],
        ...checks2.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
      ]
    });
  };
  inst.clone = (def2, params) => clone(inst, def2, params);
  inst.brand = () => inst;
  inst.register = (reg, meta) => {
    reg.add(inst, meta);
    return inst;
  };
  inst.parse = (data, params) => parse2(inst, data, params, { callee: inst.parse });
  inst.safeParse = (data, params) => safeParse2(inst, data, params);
  inst.parseAsync = async (data, params) => parseAsync(inst, data, params, { callee: inst.parseAsync });
  inst.safeParseAsync = async (data, params) => safeParseAsync2(inst, data, params);
  inst.spa = inst.safeParseAsync;
  inst.refine = (check, params) => inst.check(refine(check, params));
  inst.superRefine = (refinement) => inst.check(superRefine(refinement));
  inst.overwrite = (fn) => inst.check(_overwrite(fn));
  inst.optional = () => optional(inst);
  inst.nullable = () => nullable(inst);
  inst.nullish = () => optional(nullable(inst));
  inst.nonoptional = (params) => nonoptional(inst, params);
  inst.array = () => array(inst);
  inst.or = (arg) => union([inst, arg]);
  inst.and = (arg) => intersection(inst, arg);
  inst.transform = (tx) => pipe(inst, transform(tx));
  inst.default = (def2) => _default(inst, def2);
  inst.prefault = (def2) => prefault(inst, def2);
  inst.catch = (params) => _catch(inst, params);
  inst.pipe = (target) => pipe(inst, target);
  inst.readonly = () => readonly(inst);
  inst.describe = (description) => {
    const cl = inst.clone();
    globalRegistry.add(cl, { description });
    return cl;
  };
  Object.defineProperty(inst, "description", {
    get() {
      return globalRegistry.get(inst)?.description;
    },
    configurable: true
  });
  inst.meta = (...args) => {
    if (args.length === 0) {
      return globalRegistry.get(inst);
    }
    const cl = inst.clone();
    globalRegistry.add(cl, args[0]);
    return cl;
  };
  inst.isOptional = () => inst.safeParse(undefined).success;
  inst.isNullable = () => inst.safeParse(null).success;
  return inst;
});
var _ZodString = /* @__PURE__ */ $constructor("_ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  ZodType.init(inst, def);
  const bag = inst._zod.bag;
  inst.format = bag.format ?? null;
  inst.minLength = bag.minimum ?? null;
  inst.maxLength = bag.maximum ?? null;
  inst.regex = (...args) => inst.check(_regex(...args));
  inst.includes = (...args) => inst.check(_includes(...args));
  inst.startsWith = (...args) => inst.check(_startsWith(...args));
  inst.endsWith = (...args) => inst.check(_endsWith(...args));
  inst.min = (...args) => inst.check(_minLength(...args));
  inst.max = (...args) => inst.check(_maxLength(...args));
  inst.length = (...args) => inst.check(_length(...args));
  inst.nonempty = (...args) => inst.check(_minLength(1, ...args));
  inst.lowercase = (params) => inst.check(_lowercase(params));
  inst.uppercase = (params) => inst.check(_uppercase(params));
  inst.trim = () => inst.check(_trim());
  inst.normalize = (...args) => inst.check(_normalize(...args));
  inst.toLowerCase = () => inst.check(_toLowerCase());
  inst.toUpperCase = () => inst.check(_toUpperCase());
});
var ZodString = /* @__PURE__ */ $constructor("ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  _ZodString.init(inst, def);
  inst.email = (params) => inst.check(_email(ZodEmail, params));
  inst.url = (params) => inst.check(_url(ZodURL, params));
  inst.jwt = (params) => inst.check(_jwt(ZodJWT, params));
  inst.emoji = (params) => inst.check(_emoji2(ZodEmoji, params));
  inst.guid = (params) => inst.check(_guid(ZodGUID, params));
  inst.uuid = (params) => inst.check(_uuid(ZodUUID, params));
  inst.uuidv4 = (params) => inst.check(_uuidv4(ZodUUID, params));
  inst.uuidv6 = (params) => inst.check(_uuidv6(ZodUUID, params));
  inst.uuidv7 = (params) => inst.check(_uuidv7(ZodUUID, params));
  inst.nanoid = (params) => inst.check(_nanoid(ZodNanoID, params));
  inst.guid = (params) => inst.check(_guid(ZodGUID, params));
  inst.cuid = (params) => inst.check(_cuid(ZodCUID, params));
  inst.cuid2 = (params) => inst.check(_cuid2(ZodCUID2, params));
  inst.ulid = (params) => inst.check(_ulid(ZodULID, params));
  inst.base64 = (params) => inst.check(_base64(ZodBase64, params));
  inst.base64url = (params) => inst.check(_base64url(ZodBase64URL, params));
  inst.xid = (params) => inst.check(_xid(ZodXID, params));
  inst.ksuid = (params) => inst.check(_ksuid(ZodKSUID, params));
  inst.ipv4 = (params) => inst.check(_ipv4(ZodIPv4, params));
  inst.ipv6 = (params) => inst.check(_ipv6(ZodIPv6, params));
  inst.cidrv4 = (params) => inst.check(_cidrv4(ZodCIDRv4, params));
  inst.cidrv6 = (params) => inst.check(_cidrv6(ZodCIDRv6, params));
  inst.e164 = (params) => inst.check(_e164(ZodE164, params));
  inst.datetime = (params) => inst.check(datetime2(params));
  inst.date = (params) => inst.check(date2(params));
  inst.time = (params) => inst.check(time2(params));
  inst.duration = (params) => inst.check(duration2(params));
});
function string2(params) {
  return _string(ZodString, params);
}
var ZodStringFormat = /* @__PURE__ */ $constructor("ZodStringFormat", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  _ZodString.init(inst, def);
});
var ZodEmail = /* @__PURE__ */ $constructor("ZodEmail", (inst, def) => {
  $ZodEmail.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodGUID = /* @__PURE__ */ $constructor("ZodGUID", (inst, def) => {
  $ZodGUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodUUID = /* @__PURE__ */ $constructor("ZodUUID", (inst, def) => {
  $ZodUUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodURL = /* @__PURE__ */ $constructor("ZodURL", (inst, def) => {
  $ZodURL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodEmoji = /* @__PURE__ */ $constructor("ZodEmoji", (inst, def) => {
  $ZodEmoji.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNanoID = /* @__PURE__ */ $constructor("ZodNanoID", (inst, def) => {
  $ZodNanoID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID = /* @__PURE__ */ $constructor("ZodCUID", (inst, def) => {
  $ZodCUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID2 = /* @__PURE__ */ $constructor("ZodCUID2", (inst, def) => {
  $ZodCUID2.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodULID = /* @__PURE__ */ $constructor("ZodULID", (inst, def) => {
  $ZodULID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodXID = /* @__PURE__ */ $constructor("ZodXID", (inst, def) => {
  $ZodXID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodKSUID = /* @__PURE__ */ $constructor("ZodKSUID", (inst, def) => {
  $ZodKSUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv4 = /* @__PURE__ */ $constructor("ZodIPv4", (inst, def) => {
  $ZodIPv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv6 = /* @__PURE__ */ $constructor("ZodIPv6", (inst, def) => {
  $ZodIPv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv4 = /* @__PURE__ */ $constructor("ZodCIDRv4", (inst, def) => {
  $ZodCIDRv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv6 = /* @__PURE__ */ $constructor("ZodCIDRv6", (inst, def) => {
  $ZodCIDRv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64 = /* @__PURE__ */ $constructor("ZodBase64", (inst, def) => {
  $ZodBase64.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64URL = /* @__PURE__ */ $constructor("ZodBase64URL", (inst, def) => {
  $ZodBase64URL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodE164 = /* @__PURE__ */ $constructor("ZodE164", (inst, def) => {
  $ZodE164.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodJWT = /* @__PURE__ */ $constructor("ZodJWT", (inst, def) => {
  $ZodJWT.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNumber = /* @__PURE__ */ $constructor("ZodNumber", (inst, def) => {
  $ZodNumber.init(inst, def);
  ZodType.init(inst, def);
  inst.gt = (value, params) => inst.check(_gt(value, params));
  inst.gte = (value, params) => inst.check(_gte(value, params));
  inst.min = (value, params) => inst.check(_gte(value, params));
  inst.lt = (value, params) => inst.check(_lt(value, params));
  inst.lte = (value, params) => inst.check(_lte(value, params));
  inst.max = (value, params) => inst.check(_lte(value, params));
  inst.int = (params) => inst.check(int(params));
  inst.safe = (params) => inst.check(int(params));
  inst.positive = (params) => inst.check(_gt(0, params));
  inst.nonnegative = (params) => inst.check(_gte(0, params));
  inst.negative = (params) => inst.check(_lt(0, params));
  inst.nonpositive = (params) => inst.check(_lte(0, params));
  inst.multipleOf = (value, params) => inst.check(_multipleOf(value, params));
  inst.step = (value, params) => inst.check(_multipleOf(value, params));
  inst.finite = () => inst;
  const bag = inst._zod.bag;
  inst.minValue = Math.max(bag.minimum ?? Number.NEGATIVE_INFINITY, bag.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null;
  inst.maxValue = Math.min(bag.maximum ?? Number.POSITIVE_INFINITY, bag.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null;
  inst.isInt = (bag.format ?? "").includes("int") || Number.isSafeInteger(bag.multipleOf ?? 0.5);
  inst.isFinite = true;
  inst.format = bag.format ?? null;
});
function number2(params) {
  return _number(ZodNumber, params);
}
var ZodNumberFormat = /* @__PURE__ */ $constructor("ZodNumberFormat", (inst, def) => {
  $ZodNumberFormat.init(inst, def);
  ZodNumber.init(inst, def);
});
function int(params) {
  return _int(ZodNumberFormat, params);
}
var ZodBoolean = /* @__PURE__ */ $constructor("ZodBoolean", (inst, def) => {
  $ZodBoolean.init(inst, def);
  ZodType.init(inst, def);
});
function boolean2(params) {
  return _boolean(ZodBoolean, params);
}
var ZodNull = /* @__PURE__ */ $constructor("ZodNull", (inst, def) => {
  $ZodNull.init(inst, def);
  ZodType.init(inst, def);
});
function _null3(params) {
  return _null2(ZodNull, params);
}
var ZodUnknown = /* @__PURE__ */ $constructor("ZodUnknown", (inst, def) => {
  $ZodUnknown.init(inst, def);
  ZodType.init(inst, def);
});
function unknown() {
  return _unknown(ZodUnknown);
}
var ZodNever = /* @__PURE__ */ $constructor("ZodNever", (inst, def) => {
  $ZodNever.init(inst, def);
  ZodType.init(inst, def);
});
function never(params) {
  return _never(ZodNever, params);
}
var ZodArray = /* @__PURE__ */ $constructor("ZodArray", (inst, def) => {
  $ZodArray.init(inst, def);
  ZodType.init(inst, def);
  inst.element = def.element;
  inst.min = (minLength, params) => inst.check(_minLength(minLength, params));
  inst.nonempty = (params) => inst.check(_minLength(1, params));
  inst.max = (maxLength, params) => inst.check(_maxLength(maxLength, params));
  inst.length = (len, params) => inst.check(_length(len, params));
  inst.unwrap = () => inst.element;
});
function array(element, params) {
  return _array(ZodArray, element, params);
}
var ZodObject = /* @__PURE__ */ $constructor("ZodObject", (inst, def) => {
  $ZodObject.init(inst, def);
  ZodType.init(inst, def);
  exports_util.defineLazy(inst, "shape", () => def.shape);
  inst.keyof = () => _enum(Object.keys(inst._zod.def.shape));
  inst.catchall = (catchall) => inst.clone({ ...inst._zod.def, catchall });
  inst.passthrough = () => inst.clone({ ...inst._zod.def, catchall: unknown() });
  inst.loose = () => inst.clone({ ...inst._zod.def, catchall: unknown() });
  inst.strict = () => inst.clone({ ...inst._zod.def, catchall: never() });
  inst.strip = () => inst.clone({ ...inst._zod.def, catchall: undefined });
  inst.extend = (incoming) => {
    return exports_util.extend(inst, incoming);
  };
  inst.merge = (other) => exports_util.merge(inst, other);
  inst.pick = (mask) => exports_util.pick(inst, mask);
  inst.omit = (mask) => exports_util.omit(inst, mask);
  inst.partial = (...args) => exports_util.partial(ZodOptional, inst, args[0]);
  inst.required = (...args) => exports_util.required(ZodNonOptional, inst, args[0]);
});
function strictObject(shape, params) {
  return new ZodObject({
    type: "object",
    get shape() {
      exports_util.assignProp(this, "shape", { ...shape });
      return this.shape;
    },
    catchall: never(),
    ...exports_util.normalizeParams(params)
  });
}
var ZodUnion = /* @__PURE__ */ $constructor("ZodUnion", (inst, def) => {
  $ZodUnion.init(inst, def);
  ZodType.init(inst, def);
  inst.options = def.options;
});
function union(options, params) {
  return new ZodUnion({
    type: "union",
    options,
    ...exports_util.normalizeParams(params)
  });
}
var ZodIntersection = /* @__PURE__ */ $constructor("ZodIntersection", (inst, def) => {
  $ZodIntersection.init(inst, def);
  ZodType.init(inst, def);
});
function intersection(left, right) {
  return new ZodIntersection({
    type: "intersection",
    left,
    right
  });
}
var ZodEnum = /* @__PURE__ */ $constructor("ZodEnum", (inst, def) => {
  $ZodEnum.init(inst, def);
  ZodType.init(inst, def);
  inst.enum = def.entries;
  inst.options = Object.values(def.entries);
  const keys = new Set(Object.keys(def.entries));
  inst.extract = (values, params) => {
    const newEntries = {};
    for (const value of values) {
      if (keys.has(value)) {
        newEntries[value] = def.entries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...exports_util.normalizeParams(params),
      entries: newEntries
    });
  };
  inst.exclude = (values, params) => {
    const newEntries = { ...def.entries };
    for (const value of values) {
      if (keys.has(value)) {
        delete newEntries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...exports_util.normalizeParams(params),
      entries: newEntries
    });
  };
});
function _enum(values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodEnum({
    type: "enum",
    entries,
    ...exports_util.normalizeParams(params)
  });
}
var ZodLiteral = /* @__PURE__ */ $constructor("ZodLiteral", (inst, def) => {
  $ZodLiteral.init(inst, def);
  ZodType.init(inst, def);
  inst.values = new Set(def.values);
  Object.defineProperty(inst, "value", {
    get() {
      if (def.values.length > 1) {
        throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
      }
      return def.values[0];
    }
  });
});
function literal(value, params) {
  return new ZodLiteral({
    type: "literal",
    values: Array.isArray(value) ? value : [value],
    ...exports_util.normalizeParams(params)
  });
}
var ZodTransform = /* @__PURE__ */ $constructor("ZodTransform", (inst, def) => {
  $ZodTransform.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(exports_util.issue(issue2, payload.value, def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = inst);
        _issue.continue ?? (_issue.continue = true);
        payload.issues.push(exports_util.issue(_issue));
      }
    };
    const output = def.transform(payload.value, payload);
    if (output instanceof Promise) {
      return output.then((output2) => {
        payload.value = output2;
        return payload;
      });
    }
    payload.value = output;
    return payload;
  };
});
function transform(fn) {
  return new ZodTransform({
    type: "transform",
    transform: fn
  });
}
var ZodOptional = /* @__PURE__ */ $constructor("ZodOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  ZodType.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
  return new ZodOptional({
    type: "optional",
    innerType
  });
}
var ZodNullable = /* @__PURE__ */ $constructor("ZodNullable", (inst, def) => {
  $ZodNullable.init(inst, def);
  ZodType.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
  return new ZodNullable({
    type: "nullable",
    innerType
  });
}
var ZodDefault = /* @__PURE__ */ $constructor("ZodDefault", (inst, def) => {
  $ZodDefault.init(inst, def);
  ZodType.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
  return new ZodDefault({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : defaultValue;
    }
  });
}
var ZodPrefault = /* @__PURE__ */ $constructor("ZodPrefault", (inst, def) => {
  $ZodPrefault.init(inst, def);
  ZodType.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
  return new ZodPrefault({
    type: "prefault",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : defaultValue;
    }
  });
}
var ZodNonOptional = /* @__PURE__ */ $constructor("ZodNonOptional", (inst, def) => {
  $ZodNonOptional.init(inst, def);
  ZodType.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
  return new ZodNonOptional({
    type: "nonoptional",
    innerType,
    ...exports_util.normalizeParams(params)
  });
}
var ZodCatch = /* @__PURE__ */ $constructor("ZodCatch", (inst, def) => {
  $ZodCatch.init(inst, def);
  ZodType.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
  return new ZodCatch({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
  });
}
var ZodPipe = /* @__PURE__ */ $constructor("ZodPipe", (inst, def) => {
  $ZodPipe.init(inst, def);
  ZodType.init(inst, def);
  inst.in = def.in;
  inst.out = def.out;
});
function pipe(in_, out) {
  return new ZodPipe({
    type: "pipe",
    in: in_,
    out
  });
}
var ZodReadonly = /* @__PURE__ */ $constructor("ZodReadonly", (inst, def) => {
  $ZodReadonly.init(inst, def);
  ZodType.init(inst, def);
});
function readonly(innerType) {
  return new ZodReadonly({
    type: "readonly",
    innerType
  });
}
var ZodCustom = /* @__PURE__ */ $constructor("ZodCustom", (inst, def) => {
  $ZodCustom.init(inst, def);
  ZodType.init(inst, def);
});
function check(fn) {
  const ch = new $ZodCheck({
    check: "custom"
  });
  ch._zod.check = fn;
  return ch;
}
function refine(fn, _params = {}) {
  return _refine(ZodCustom, fn, _params);
}
function superRefine(fn) {
  const ch = check((payload) => {
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(exports_util.issue(issue2, payload.value, ch._zod.def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = ch);
        _issue.continue ?? (_issue.continue = !ch._zod.def.abort);
        payload.issues.push(exports_util.issue(_issue));
      }
    };
    return fn(payload.value, payload);
  });
  return ch;
}
// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v4/classic/external.js
config(en_default());

// src/todos/common.ts
var TODOS_CONTRACT_VERSION = "1.0.0";
var TODOS_MANIFEST_VERSION = "1";
var TodosAudienceSchema = _enum(["customer", "tenant_admin"]);
var TodosTimestampSchema = exports_iso.datetime({ offset: true });
var TodosDateSchema = exports_iso.date();
var TodosEntityIdSchema = string2().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
var TodosOwnerIdSchema = string2().min(2).max(128).regex(/^[a-z][a-z0-9.-]*$/);
var TodosSlugSchema = string2().min(1).max(96).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
var TodosRequestIdSchema = string2().min(8).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
var TodosIdempotencyKeySchema = string2().min(8).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
var TodosSha256DigestSchema = string2().regex(/^[a-f0-9]{64}$/);
var TodosCursorSchema = string2().min(1).max(512);
var TodosRelativePathSchema = string2().min(1).max(1024).superRefine((value, ctx) => {
  if (value.startsWith("/") || value.startsWith("\\") || value.includes("\\") || value.split("/").some((segment) => segment === "..")) {
    ctx.addIssue({
      code: "custom",
      message: "Paths must be relative and must not traverse parent directories"
    });
  }
});
var TodosPortableScalarSchema = union([
  string2().max(4096),
  number2().finite(),
  boolean2(),
  _null3()
]);
var TodosOwnerQualifiedRefSchema = strictObject({
  owner: TodosOwnerIdSchema,
  kind: string2().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/),
  id: TodosEntityIdSchema,
  digest: TodosSha256DigestSchema
});
var TodosContentRefSchema = strictObject({
  algorithm: literal("sha256"),
  digest: TodosSha256DigestSchema,
  mediaType: string2().min(1).max(160),
  byteLength: number2().int().nonnegative()
});
var TodosPageRequestSchema = strictObject({
  cursor: TodosCursorSchema.nullable(),
  limit: number2().int().positive().max(500)
});
var TodosResponseMetaSchema = strictObject({
  requestId: TodosRequestIdSchema,
  authorityId: TodosOwnerIdSchema,
  contractVersion: literal(TODOS_CONTRACT_VERSION),
  manifestVersion: literal(TODOS_MANIFEST_VERSION)
});
function canonicalizeTodosValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalizeTodosValue);
  }
  if (value && typeof value === "object") {
    const record = value;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalizeTodosValue(record[key])]));
  }
  return value;
}
function stableTodosJson(value) {
  return JSON.stringify(canonicalizeTodosValue(value));
}
function sha256TodosValue(value) {
  return createHash("sha256").update(stableTodosJson(value), "utf8").digest("hex");
}
function sha256TodosText(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v3/external.js
var exports_external = {};
__export(exports_external, {
  void: () => voidType,
  util: () => util,
  unknown: () => unknownType,
  union: () => unionType,
  undefined: () => undefinedType,
  tuple: () => tupleType,
  transformer: () => effectsType,
  symbol: () => symbolType,
  string: () => stringType,
  strictObject: () => strictObjectType,
  setErrorMap: () => setErrorMap,
  set: () => setType,
  record: () => recordType,
  quotelessJson: () => quotelessJson,
  promise: () => promiseType,
  preprocess: () => preprocessType,
  pipeline: () => pipelineType,
  ostring: () => ostring,
  optional: () => optionalType,
  onumber: () => onumber,
  oboolean: () => oboolean,
  objectUtil: () => objectUtil,
  object: () => objectType,
  number: () => numberType,
  nullable: () => nullableType,
  null: () => nullType,
  never: () => neverType,
  nativeEnum: () => nativeEnumType,
  nan: () => nanType,
  map: () => mapType,
  makeIssue: () => makeIssue,
  literal: () => literalType,
  lazy: () => lazyType,
  late: () => late,
  isValid: () => isValid,
  isDirty: () => isDirty,
  isAsync: () => isAsync,
  isAborted: () => isAborted,
  intersection: () => intersectionType,
  instanceof: () => instanceOfType,
  getParsedType: () => getParsedType2,
  getErrorMap: () => getErrorMap,
  function: () => functionType,
  enum: () => enumType,
  effect: () => effectsType,
  discriminatedUnion: () => discriminatedUnionType,
  defaultErrorMap: () => en_default2,
  datetimeRegex: () => datetimeRegex,
  date: () => dateType,
  custom: () => custom,
  coerce: () => coerce,
  boolean: () => booleanType,
  bigint: () => bigIntType,
  array: () => arrayType,
  any: () => anyType,
  addIssueToContext: () => addIssueToContext,
  ZodVoid: () => ZodVoid,
  ZodUnknown: () => ZodUnknown2,
  ZodUnion: () => ZodUnion2,
  ZodUndefined: () => ZodUndefined,
  ZodType: () => ZodType2,
  ZodTuple: () => ZodTuple,
  ZodTransformer: () => ZodEffects,
  ZodSymbol: () => ZodSymbol,
  ZodString: () => ZodString2,
  ZodSet: () => ZodSet,
  ZodSchema: () => ZodType2,
  ZodRecord: () => ZodRecord,
  ZodReadonly: () => ZodReadonly2,
  ZodPromise: () => ZodPromise,
  ZodPipeline: () => ZodPipeline,
  ZodParsedType: () => ZodParsedType,
  ZodOptional: () => ZodOptional2,
  ZodObject: () => ZodObject2,
  ZodNumber: () => ZodNumber2,
  ZodNullable: () => ZodNullable2,
  ZodNull: () => ZodNull2,
  ZodNever: () => ZodNever2,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNaN: () => ZodNaN,
  ZodMap: () => ZodMap,
  ZodLiteral: () => ZodLiteral2,
  ZodLazy: () => ZodLazy,
  ZodIssueCode: () => ZodIssueCode,
  ZodIntersection: () => ZodIntersection2,
  ZodFunction: () => ZodFunction,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodError: () => ZodError2,
  ZodEnum: () => ZodEnum2,
  ZodEffects: () => ZodEffects,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodDefault: () => ZodDefault2,
  ZodDate: () => ZodDate,
  ZodCatch: () => ZodCatch2,
  ZodBranded: () => ZodBranded,
  ZodBoolean: () => ZodBoolean2,
  ZodBigInt: () => ZodBigInt,
  ZodArray: () => ZodArray2,
  ZodAny: () => ZodAny,
  Schema: () => ZodType2,
  ParseStatus: () => ParseStatus,
  OK: () => OK,
  NEVER: () => NEVER2,
  INVALID: () => INVALID,
  EMPTY_PATH: () => EMPTY_PATH,
  DIRTY: () => DIRTY,
  BRAND: () => BRAND
});

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {};
  function assertIs2(_arg) {}
  util2.assertIs = assertIs2;
  function assertNever2(_x) {
    throw new Error;
  }
  util2.assertNever = assertNever2;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues2(array2, separator = " | ") {
    return array2.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues2;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType2 = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};

class ZodError2 extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue2) {
      return issue2.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error2) => {
      for (const issue2 of error2.issues) {
        if (issue2.code === "invalid_union") {
          issue2.unionErrors.map(processError);
        } else if (issue2.code === "invalid_return_type") {
          processError(issue2.returnTypeError);
        } else if (issue2.code === "invalid_arguments") {
          processError(issue2.argumentsError);
        } else if (issue2.path.length === 0) {
          fieldErrors._errors.push(mapper(issue2));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue2.path.length) {
            const el = issue2.path[i];
            const terminal = i === issue2.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue2));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof ZodError2)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue2) => issue2.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
}
ZodError2.create = (issues) => {
  const error2 = new ZodError2(issues);
  return error2;
};

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v3/locales/en.js
var errorMap = (issue2, _ctx) => {
  let message;
  switch (issue2.code) {
    case ZodIssueCode.invalid_type:
      if (issue2.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue2.expected}, received ${issue2.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue2.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue2.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue2.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue2.options)}, received '${issue2.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue2.validation === "object") {
        if ("includes" in issue2.validation) {
          message = `Invalid input: must include "${issue2.validation.includes}"`;
          if (typeof issue2.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue2.validation.position}`;
          }
        } else if ("startsWith" in issue2.validation) {
          message = `Invalid input: must start with "${issue2.validation.startsWith}"`;
        } else if ("endsWith" in issue2.validation) {
          message = `Invalid input: must end with "${issue2.validation.endsWith}"`;
        } else {
          util.assertNever(issue2.validation);
        }
      } else if (issue2.validation !== "regex") {
        message = `Invalid ${issue2.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue2.type === "array")
        message = `Array must contain ${issue2.exact ? "exactly" : issue2.inclusive ? `at least` : `more than`} ${issue2.minimum} element(s)`;
      else if (issue2.type === "string")
        message = `String must contain ${issue2.exact ? "exactly" : issue2.inclusive ? `at least` : `over`} ${issue2.minimum} character(s)`;
      else if (issue2.type === "number")
        message = `Number must be ${issue2.exact ? `exactly equal to ` : issue2.inclusive ? `greater than or equal to ` : `greater than `}${issue2.minimum}`;
      else if (issue2.type === "bigint")
        message = `Number must be ${issue2.exact ? `exactly equal to ` : issue2.inclusive ? `greater than or equal to ` : `greater than `}${issue2.minimum}`;
      else if (issue2.type === "date")
        message = `Date must be ${issue2.exact ? `exactly equal to ` : issue2.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue2.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue2.type === "array")
        message = `Array must contain ${issue2.exact ? `exactly` : issue2.inclusive ? `at most` : `less than`} ${issue2.maximum} element(s)`;
      else if (issue2.type === "string")
        message = `String must contain ${issue2.exact ? `exactly` : issue2.inclusive ? `at most` : `under`} ${issue2.maximum} character(s)`;
      else if (issue2.type === "number")
        message = `Number must be ${issue2.exact ? `exactly` : issue2.inclusive ? `less than or equal to` : `less than`} ${issue2.maximum}`;
      else if (issue2.type === "bigint")
        message = `BigInt must be ${issue2.exact ? `exactly` : issue2.inclusive ? `less than or equal to` : `less than`} ${issue2.maximum}`;
      else if (issue2.type === "date")
        message = `Date must be ${issue2.exact ? `exactly` : issue2.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue2.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue2.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue2);
  }
  return { message };
};
var en_default2 = errorMap;

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v3/errors.js
var overrideErrorMap = en_default2;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}
// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== undefined) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue2 = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      ctx.schemaErrorMap,
      overrideMap,
      overrideMap === en_default2 ? undefined : en_default2
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue2);
}

class ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
}
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;
// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v3/types.js
class ParseInputLazyPath {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
}
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error2 = new ZodError2(ctx.common.issues);
        this._error = error2;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}

class ZodType2 {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType2(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType2(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus,
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType2(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType2(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType2(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType2(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check2, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check2(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check2, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check2(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional2.create(this, this._def);
  }
  nullable() {
    return ZodNullable2.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray2.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion2.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection2.create(this, incoming, this._def);
  }
  transform(transform2) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform: transform2 }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault2({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch2({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly2.create(this);
  }
  isOptional() {
    return this.safeParse(undefined).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
}
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version2) {
  if ((version2 === "v4" || !version2) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version2 === "v6" || !version2) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT2(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base642 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base642));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version2) {
  if ((version2 === "v4" || !version2) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version2 === "v6" || !version2) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}

class ZodString2 extends ZodType2 {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus;
    let ctx = undefined;
    for (const check2 of this._def.checks) {
      if (check2.kind === "min") {
        if (input.data.length < check2.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check2.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "max") {
        if (input.data.length > check2.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check2.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "length") {
        const tooBig = input.data.length > check2.value;
        const tooSmall = input.data.length < check2.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check2.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check2.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check2.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check2.message
            });
          }
          status.dirty();
        }
      } else if (check2.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "regex") {
        check2.regex.lastIndex = 0;
        const testResult = check2.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "trim") {
        input.data = input.data.trim();
      } else if (check2.kind === "includes") {
        if (!input.data.includes(check2.value, check2.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check2.value, position: check2.position },
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check2.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check2.kind === "startsWith") {
        if (!input.data.startsWith(check2.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check2.value },
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "endsWith") {
        if (!input.data.endsWith(check2.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check2.value },
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "datetime") {
        const regex = datetimeRegex(check2);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "time") {
        const regex = timeRegex(check2);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "ip") {
        if (!isValidIP(input.data, check2.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "jwt") {
        if (!isValidJWT2(input.data, check2.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "cidr") {
        if (!isValidCidr(input.data, check2.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check2);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check2) {
    return new ZodString2({
      ...this._def,
      checks: [...this._def.checks, check2]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new ZodString2({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new ZodString2({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new ZodString2({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
}
ZodString2.create = (params) => {
  return new ZodString2({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder2(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}

class ZodNumber2 extends ZodType2 {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = undefined;
    const status = new ParseStatus;
    for (const check2 of this._def.checks) {
      if (check2.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "min") {
        const tooSmall = check2.inclusive ? input.data < check2.value : input.data <= check2.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check2.value,
            type: "number",
            inclusive: check2.inclusive,
            exact: false,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "max") {
        const tooBig = check2.inclusive ? input.data > check2.value : input.data >= check2.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check2.value,
            type: "number",
            inclusive: check2.inclusive,
            exact: false,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "multipleOf") {
        if (floatSafeRemainder2(input.data, check2.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check2.value,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check2.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check2);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new ZodNumber2({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check2) {
    return new ZodNumber2({
      ...this._def,
      checks: [...this._def.checks, check2]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
}
ZodNumber2.create = (params) => {
  return new ZodNumber2({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};

class ZodBigInt extends ZodType2 {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = undefined;
    const status = new ParseStatus;
    for (const check2 of this._def.checks) {
      if (check2.kind === "min") {
        const tooSmall = check2.inclusive ? input.data < check2.value : input.data <= check2.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check2.value,
            inclusive: check2.inclusive,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "max") {
        const tooBig = check2.inclusive ? input.data > check2.value : input.data >= check2.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check2.value,
            inclusive: check2.inclusive,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "multipleOf") {
        if (input.data % check2.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check2.value,
            message: check2.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check2);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check2) {
    return new ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check2]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
}
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};

class ZodBoolean2 extends ZodType2 {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodBoolean2.create = (params) => {
  return new ZodBoolean2({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};

class ZodDate extends ZodType2 {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus;
    let ctx = undefined;
    for (const check2 of this._def.checks) {
      if (check2.kind === "min") {
        if (input.data.getTime() < check2.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check2.message,
            inclusive: true,
            exact: false,
            minimum: check2.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check2.kind === "max") {
        if (input.data.getTime() > check2.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check2.message,
            inclusive: true,
            exact: false,
            maximum: check2.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check2);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check2) {
    return new ZodDate({
      ...this._def,
      checks: [...this._def.checks, check2]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
}
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};

class ZodSymbol extends ZodType2 {
  _parse(input) {
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};

class ZodUndefined extends ZodType2 {
  _parse(input) {
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};

class ZodNull2 extends ZodType2 {
  _parse(input) {
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodNull2.create = (params) => {
  return new ZodNull2({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};

class ZodAny extends ZodType2 {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
}
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};

class ZodUnknown2 extends ZodType2 {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
}
ZodUnknown2.create = (params) => {
  return new ZodUnknown2({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};

class ZodNever2 extends ZodType2 {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
}
ZodNever2.create = (params) => {
  return new ZodNever2({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};

class ZodVoid extends ZodType2 {
  _parse(input) {
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};

class ZodArray2 extends ZodType2 {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : undefined,
          maximum: tooBig ? def.exactLength.value : undefined,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new ZodArray2({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new ZodArray2({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new ZodArray2({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
}
ZodArray2.create = (schema, params) => {
  return new ZodArray2({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject2) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional2.create(deepPartialify(fieldSchema));
    }
    return new ZodObject2({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray2) {
    return new ZodArray2({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional2) {
    return ZodOptional2.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable2) {
    return ZodNullable2.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}

class ZodObject2 extends ZodType2 {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever2 && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever2) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {} else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new ZodObject2({
      ...this._def,
      unknownKeys: "strict",
      ...message !== undefined ? {
        errorMap: (issue2, ctx) => {
          const defaultError = this._def.errorMap?.(issue2, ctx).message ?? ctx.defaultError;
          if (issue2.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new ZodObject2({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new ZodObject2({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  extend(augmentation) {
    return new ZodObject2({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  merge(merging) {
    const merged = new ZodObject2({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  catchall(index) {
    return new ZodObject2({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new ZodObject2({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new ZodObject2({
      ...this._def,
      shape: () => shape
    });
  }
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new ZodObject2({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional2) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new ZodObject2({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
}
ZodObject2.create = (shape, params) => {
  return new ZodObject2({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever2.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject2.strictCreate = (shape, params) => {
  return new ZodObject2({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever2.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject2.lazycreate = (shape, params) => {
  return new ZodObject2({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever2.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};

class ZodUnion2 extends ZodType2 {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError2(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = undefined;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError2(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
}
ZodUnion2.create = (types, params) => {
  return new ZodUnion2({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral2) {
    return [type.value];
  } else if (type instanceof ZodEnum2) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault2) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [undefined];
  } else if (type instanceof ZodNull2) {
    return [null];
  } else if (type instanceof ZodOptional2) {
    return [undefined, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable2) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly2) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch2) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};

class ZodDiscriminatedUnion extends ZodType2 {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  static create(discriminator, options, params) {
    const optionsMap = new Map;
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
}
function mergeValues2(a, b) {
  const aType = getParsedType2(a);
  const bType = getParsedType2(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues2(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0;index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues2(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}

class ZodIntersection2 extends ZodType2 {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues2(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
}
ZodIntersection2.create = (left, right, params) => {
  return new ZodIntersection2({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};

class ZodTuple extends ZodType2 {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new ZodTuple({
      ...this._def,
      rest
    });
  }
}
ZodTuple.create = (schemas3, params) => {
  if (!Array.isArray(schemas3)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas3,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};

class ZodRecord extends ZodType2 {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType2) {
      return new ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new ZodRecord({
      keyType: ZodString2.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
}

class ZodMap extends ZodType2 {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = new Map;
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = new Map;
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
}
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};

class ZodSet extends ZodType2 {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = new Set;
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
}
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};

class ZodFunction extends ZodType2 {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error2) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default2].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error2
        }
      });
    }
    function makeReturnsIssue(returns, error2) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default2].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error2
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error2 = new ZodError2([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error2.addIssue(makeArgsIssue(args, e));
          throw error2;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error2.addIssue(makeReturnsIssue(result, e));
          throw error2;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError2([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError2([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown2.create())
    });
  }
  returns(returnType) {
    return new ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown2.create()),
      returns: returns || ZodUnknown2.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
}

class ZodLazy extends ZodType2 {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
}
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};

class ZodLiteral2 extends ZodType2 {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
}
ZodLiteral2.create = (value, params) => {
  return new ZodLiteral2({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum2({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}

class ZodEnum2 extends ZodType2 {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return ZodEnum2.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return ZodEnum2.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
}
ZodEnum2.create = createZodEnum;

class ZodNativeEnum extends ZodType2 {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
}
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};

class ZodPromise extends ZodType2 {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
}
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};

class ZodEffects extends ZodType2 {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
}
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
class ZodOptional2 extends ZodType2 {
  _parse(input) {
    const parsedType2 = this._getType(input);
    if (parsedType2 === ZodParsedType.undefined) {
      return OK(undefined);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
}
ZodOptional2.create = (type, params) => {
  return new ZodOptional2({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};

class ZodNullable2 extends ZodType2 {
  _parse(input) {
    const parsedType2 = this._getType(input);
    if (parsedType2 === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
}
ZodNullable2.create = (type, params) => {
  return new ZodNullable2({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};

class ZodDefault2 extends ZodType2 {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
}
ZodDefault2.create = (type, params) => {
  return new ZodDefault2({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};

class ZodCatch2 extends ZodType2 {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError2(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError2(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
}
ZodCatch2.create = (type, params) => {
  return new ZodCatch2({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};

class ZodNaN extends ZodType2 {
  _parse(input) {
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
}
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = Symbol("zod_brand");

class ZodBranded extends ZodType2 {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
}

class ZodPipeline extends ZodType2 {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
}

class ZodReadonly2 extends ZodType2 {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
}
ZodReadonly2.create = (type, params) => {
  return new ZodReadonly2({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check2, _params = {}, fatal) {
  if (check2)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check2(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject2.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString2.create;
var numberType = ZodNumber2.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean2.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull2.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown2.create;
var neverType = ZodNever2.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray2.create;
var objectType = ZodObject2.create;
var strictObjectType = ZodObject2.strictCreate;
var unionType = ZodUnion2.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection2.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral2.create;
var enumType = ZodEnum2.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional2.create;
var nullableType = ZodNullable2.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: (arg) => ZodString2.create({ ...arg, coerce: true }),
  number: (arg) => ZodNumber2.create({ ...arg, coerce: true }),
  boolean: (arg) => ZodBoolean2.create({
    ...arg,
    coerce: true
  }),
  bigint: (arg) => ZodBigInt.create({ ...arg, coerce: true }),
  date: (arg) => ZodDate.create({ ...arg, coerce: true })
};
var NEVER2 = INVALID;
// src/deployment.ts
var DEPLOYMENT_CONTRACT_VERSION = "1.0.0";
var DEPLOYMENT_SCHEMA_IDS = {
  productProjection: "hasna.product_projection.v1",
  intentSnapshot: "hasna.intent_snapshot.v1",
  verifiedSourceCandidate: "hasna.verified_source_candidate.v1",
  buildArtifact: "hasna.build_artifact.v1",
  artifactAttestation: "hasna.artifact_attestation.v1",
  environmentBinding: "hasna.environment_binding.v1",
  deploymentRequest: "hasna.deployment_request.v1",
  deploymentPlan: "hasna.deployment_plan.v1",
  deploymentApprovalDecision: "hasna.deployment_approval_decision.v1",
  deploymentAttempt: "hasna.deployment_attempt.v1",
  providerReceipt: "hasna.provider_receipt.v1",
  deploymentReceipt: "hasna.deployment_receipt.v1",
  launchEvidence: "hasna.launch_evidence.v1"
};
var DEPLOYMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
var DEPLOYMENT_NAME = /^[a-z][a-z0-9._-]{0,127}$/;
var OPERATION_ID = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
var ENVIRONMENT_KEY = /^[A-Z][A-Z0-9_]*$/;
var GIT_SHA = /^[a-f0-9]{40}$/;
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var FORBIDDEN_FIELD = /(?:^|_)(?:command|commands|script|scripts|shell|argv|environment_map|env_map|provider_request_body|raw_provider_state|terraform_state|callback_body|hook|hooks|secret_value|token_value|password|passphrase|private_key|database_url|credential_value)(?:$|_)/i;
var SECRET_VALUE_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{8,}\b/i,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bhasna_[a-z0-9_]+\.[A-Za-z0-9._-]{12,}\b/,
  /^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s]+@/i,
  /^(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\//i,
  /\b(?:password|passphrase|api[_-]?key|access[_-]?key|token|secret)\s*[:=]\s*\S{8,}/i,
  /(?:^|[^A-Za-z0-9_-])[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:$|[^A-Za-z0-9_-])/
];
var EXECUTABLE_VALUE_PATTERNS = [
  /^#!\//,
  /^(?:ba|z|k|c|fi)?sh\s+-c\b/i,
  /^(?:sudo|curl|wget|terraform|tofu|kubectl|helm|docker|podman|aws|gcloud|az|npm|bun|node|python|ruby|perl|make)\s+/i,
  /(?:&&|\|\||\$\(|`[^`]+`|\$\{[^}]+\})/
];
function addDeploymentSafetyIssues(value, ctx, path = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => addDeploymentSafetyIssues(item, ctx, [...path, index]));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_").toLowerCase();
      if (FORBIDDEN_FIELD.test(normalized)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Deployment contracts cannot contain executable, raw provider, state, or secret-bearing fields",
          path: [...path, key]
        });
      }
      addDeploymentSafetyIssues(child, ctx, [...path, key]);
    }
    return;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Deployment contract numbers must be finite",
      path
    });
    return;
  }
  if (typeof value !== "string")
    return;
  if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Deployment contracts cannot contain secret or credential values",
      path
    });
  }
  if (EXECUTABLE_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Deployment contracts cannot contain commands, scripts, or templated executable strings",
      path
    });
  }
}
function assertCanonicalDeploymentValue(value, path = "<root>") {
  if (value === undefined) {
    throw new TypeError(`Deployment canonical JSON rejects undefined at ${path}`);
  }
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
    throw new TypeError(`Deployment canonical JSON rejects ${typeof value} at ${path}`);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError(`Deployment canonical JSON rejects non-finite numbers at ${path}`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertCanonicalDeploymentValue(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      assertCanonicalDeploymentValue(child, `${path}.${key}`);
    }
  }
}
function sha256DeploymentValue(value) {
  assertCanonicalDeploymentValue(value);
  return sha256TodosValue(value);
}
function sha256DeploymentText(value) {
  return sha256TodosText(value);
}
function computeDeploymentRecordDigest(value) {
  const { digest: _digest, ...unsigned } = value;
  return sha256DeploymentValue(unsigned);
}
function computeEnvironmentBindingEtag(id, revision) {
  return sha256DeploymentText(`${id}\x00${revision}`);
}
function uniqueBy(values, key, ctx, path, label) {
  const seen = new Set;
  values.forEach((value, index) => {
    const semanticId = key(value);
    if (seen.has(semanticId)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `${label} must be unique`,
        path: [...path, index]
      });
    }
    seen.add(semanticId);
  });
}
function validateDeploymentRecord(value, ctx) {
  addDeploymentSafetyIssues(value, ctx);
  let computedDigest;
  try {
    computedDigest = computeDeploymentRecordDigest(value);
  } catch (error2) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: error2 instanceof Error ? error2.message : "Deployment record cannot be canonicalized",
      path: []
    });
    return;
  }
  if (value.digest !== computedDigest) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Deployment record digest does not match canonical content",
      path: ["digest"]
    });
  }
}
function validateChronology(first, second, ctx, path) {
  if (second && Date.parse(second) < Date.parse(first)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Timestamp must not precede the record start",
      path
    });
  }
}
function isSorted(values) {
  return values.every((value, index) => index === 0 || values[index - 1].localeCompare(value) <= 0);
}
function createDeploymentSchemas(primitives) {
  const DeploymentIdSchema = exports_external.string().regex(DEPLOYMENT_ID);
  const DeploymentNameSchema = exports_external.string().regex(DEPLOYMENT_NAME);
  const DeploymentOperationIdSchema = exports_external.string().regex(OPERATION_ID);
  const DeploymentTimestampSchema = primitives.timestamp;
  const DeploymentDigestSchema = primitives.sha256Digest;
  const DeploymentEvidenceArraySchema = exports_external.array(primitives.evidencePointer).default([]);
  const DeploymentActorArraySchema = exports_external.array(primitives.actorPointer).min(1);
  const recordBase = (schema) => ({
    schema: exports_external.literal(schema),
    id: DeploymentIdSchema,
    createdAt: DeploymentTimestampSchema,
    producer: primitives.actorPointer,
    digest: DeploymentDigestSchema
  });
  const refSchema = (schema) => exports_external.object({
    schema: exports_external.literal(schema),
    id: DeploymentIdSchema,
    digest: DeploymentDigestSchema
  }).strict();
  const revisionedRefSchema = (schema) => exports_external.object({
    schema: exports_external.literal(schema),
    id: DeploymentIdSchema,
    revision: exports_external.number().int().positive(),
    digest: DeploymentDigestSchema
  }).strict();
  const ProductProjectionRefSchema = revisionedRefSchema(DEPLOYMENT_SCHEMA_IDS.productProjection);
  const IntentSnapshotRefSchema = refSchema(DEPLOYMENT_SCHEMA_IDS.intentSnapshot);
  const VerifiedSourceCandidateRefSchema = refSchema(DEPLOYMENT_SCHEMA_IDS.verifiedSourceCandidate);
  const BuildArtifactRefSchema = refSchema(DEPLOYMENT_SCHEMA_IDS.buildArtifact);
  const ArtifactAttestationRefSchema = refSchema(DEPLOYMENT_SCHEMA_IDS.artifactAttestation);
  const EnvironmentBindingRefSchema = revisionedRefSchema(DEPLOYMENT_SCHEMA_IDS.environmentBinding);
  const DeploymentRequestRefSchema = refSchema(DEPLOYMENT_SCHEMA_IDS.deploymentRequest);
  const DeploymentPlanRefSchema = refSchema(DEPLOYMENT_SCHEMA_IDS.deploymentPlan);
  const DeploymentApprovalDecisionRefSchema = refSchema(DEPLOYMENT_SCHEMA_IDS.deploymentApprovalDecision);
  const DeploymentAttemptRefSchema = revisionedRefSchema(DEPLOYMENT_SCHEMA_IDS.deploymentAttempt);
  const ProviderReceiptRefSchema = refSchema(DEPLOYMENT_SCHEMA_IDS.providerReceipt);
  const DeploymentReceiptRefSchema = refSchema(DEPLOYMENT_SCHEMA_IDS.deploymentReceipt);
  const ProductProjectionSchema = exports_external.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.productProjection),
    revision: exports_external.number().int().positive(),
    sourceProjectRef: primitives.resourcePointer,
    sourceRevision: exports_external.number().int().positive(),
    slug: exports_external.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    displayName: exports_external.string().trim().min(1).max(200),
    repositoryRef: primitives.resourcePointer,
    workspaceRef: primitives.resourcePointer,
    lifecycle: exports_external.enum(["draft", "active", "paused", "archived"]),
    ownerRefs: exports_external.array(primitives.actorPointer).min(1),
    projectedAt: DeploymentTimestampSchema,
    sourceEvidenceRefs: exports_external.array(primitives.evidencePointer).min(1)
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    uniqueBy(value.ownerRefs, (actor) => `${actor.kind}:${actor.id}`, ctx, ["ownerRefs"], "Product owner identities");
  });
  const EndpointRequirementSchema = exports_external.object({
    path: exports_external.string().regex(/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/),
    protocol: exports_external.enum(["http", "https"]),
    expectedStatuses: exports_external.array(exports_external.number().int().min(100).max(599)).min(1)
  }).strict().superRefine((value, ctx) => {
    uniqueBy(value.expectedStatuses, String, ctx, ["expectedStatuses"], "Endpoint statuses");
  });
  const RuntimeProcessSchema = exports_external.object({
    id: DeploymentNameSchema,
    role: exports_external.enum(["web", "worker", "cron", "migration", "scheduler"]),
    ports: exports_external.array(exports_external.number().int().min(1).max(65535)).default([]),
    liveness: EndpointRequirementSchema.optional(),
    readiness: EndpointRequirementSchema.optional(),
    version: EndpointRequirementSchema.optional(),
    resources: exports_external.object({
      cpuMillicores: exports_external.number().int().positive(),
      memoryMiB: exports_external.number().int().positive(),
      minReplicas: exports_external.number().int().nonnegative(),
      maxReplicas: exports_external.number().int().positive()
    }).strict()
  }).strict().superRefine((value, ctx) => {
    uniqueBy(value.ports, String, ctx, ["ports"], "Process ports");
    if (value.resources.maxReplicas < value.resources.minReplicas) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "maxReplicas must be greater than or equal to minReplicas",
        path: ["resources", "maxReplicas"]
      });
    }
  });
  const ServiceRequirementSchema = exports_external.object({
    id: DeploymentNameSchema,
    kind: exports_external.enum(["database", "object_storage", "queue", "cron", "worker"]),
    required: exports_external.boolean(),
    class: DeploymentNameSchema
  }).strict();
  const ConfigurationRequirementSchema = exports_external.object({
    name: exports_external.string().regex(ENVIRONMENT_KEY),
    kind: exports_external.enum(["configuration", "secret_reference"]),
    required: exports_external.boolean(),
    referenceClass: DeploymentNameSchema.optional()
  }).strict().superRefine((value, ctx) => {
    if (value.kind === "secret_reference" && !value.referenceClass) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Secret-reference requirements require an opaque reference class",
        path: ["referenceClass"]
      });
    }
  });
  const IntentSnapshotSchema = exports_external.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.intentSnapshot),
    product: ProductProjectionRefSchema,
    repositoryRef: primitives.resourcePointer,
    commitSha: exports_external.string().regex(GIT_SHA),
    treeSha: exports_external.string().regex(GIT_SHA),
    intentDocument: exports_external.object({
      path: primitives.relativeProjectPath,
      digest: DeploymentDigestSchema
    }).strict(),
    processes: exports_external.array(RuntimeProcessSchema).min(1),
    serviceRequirements: exports_external.array(ServiceRequirementSchema).default([]),
    migration: exports_external.object({
      compatibility: exports_external.enum(["none", "backward_compatible", "forward_compatible", "breaking"]),
      order: exports_external.enum(["before_workload", "after_workload", "independent"]),
      rollbackClass: DeploymentNameSchema
    }).strict(),
    accessClass: DeploymentNameSchema,
    networkClass: DeploymentNameSchema,
    backupClass: DeploymentNameSchema,
    restoreClass: DeploymentNameSchema,
    alarmClass: DeploymentNameSchema,
    rollbackClass: DeploymentNameSchema,
    configurationRequirements: exports_external.array(ConfigurationRequirementSchema).default([]),
    validationPlan: primitives.validationPlan,
    evidenceRefs: exports_external.array(primitives.evidencePointer).min(1)
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    uniqueBy(value.processes, (process2) => process2.id, ctx, ["processes"], "Process ids");
    uniqueBy(value.serviceRequirements, (requirement) => requirement.id, ctx, ["serviceRequirements"], "Service requirement ids");
    uniqueBy(value.configurationRequirements, (requirement) => requirement.name, ctx, ["configurationRequirements"], "Configuration requirement names");
  });
  const VerificationResultSchema = exports_external.object({
    id: DeploymentNameSchema,
    kind: exports_external.enum(["review", "test", "policy", "source_integrity"]),
    status: exports_external.enum(["passed", "failed", "not_run"]),
    evidenceRefs: exports_external.array(primitives.evidencePointer).min(1)
  }).strict();
  const VerifiedSourceCandidateSchema = exports_external.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.verifiedSourceCandidate),
    status: exports_external.enum(["candidate", "verified", "rejected", "superseded"]),
    repositoryRef: primitives.resourcePointer,
    commitSha: exports_external.string().regex(GIT_SHA),
    treeSha: exports_external.string().regex(GIT_SHA),
    branchRef: primitives.resourcePointer.optional(),
    pullRequestRef: primitives.resourcePointer.optional(),
    intent: IntentSnapshotRefSchema,
    validationPlan: primitives.validationPlan,
    verificationRun: primitives.workRun,
    results: exports_external.array(VerificationResultSchema).min(1),
    verifiers: DeploymentActorArraySchema,
    verifiedAt: DeploymentTimestampSchema,
    evidenceRefs: exports_external.array(primitives.evidencePointer).min(1)
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    uniqueBy(value.results, (result) => result.id, ctx, ["results"], "Verification result ids");
    uniqueBy(value.verifiers, (actor) => `${actor.kind}:${actor.id}`, ctx, ["verifiers"], "Verifier identities");
    if (value.status === "verified" && value.results.some((result) => result.status !== "passed")) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Verified source candidates require every declared result to pass",
        path: ["results"]
      });
    }
  });
  const BuildArtifactSchema = exports_external.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.buildArtifact),
    kind: exports_external.enum(["oci_image", "archive", "binary"]),
    mediaType: exports_external.string().trim().min(1).max(160),
    uri: primitives.uri,
    artifactDigest: DeploymentDigestSchema,
    sourceCandidate: VerifiedSourceCandidateRefSchema,
    repositoryCommitSha: exports_external.string().regex(GIT_SHA),
    repositoryTreeSha: exports_external.string().regex(GIT_SHA),
    buildWorkflowRef: primitives.resourcePointer,
    buildRun: primitives.workRun,
    builder: primitives.actorPointer,
    sbomRefs: DeploymentEvidenceArraySchema,
    provenanceRefs: DeploymentEvidenceArraySchema,
    scanRefs: DeploymentEvidenceArraySchema,
    signatureRefs: DeploymentEvidenceArraySchema,
    status: exports_external.enum(["active", "superseded", "revoked"])
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    if (value.buildRun.status !== "succeeded") {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Build artifacts require a succeeded build run",
        path: ["buildRun", "status"]
      });
    }
  });
  const ArtifactAttestationSchema = exports_external.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.artifactAttestation),
    artifact: BuildArtifactRefSchema,
    artifactDigest: DeploymentDigestSchema,
    predicateKind: DeploymentNameSchema,
    predicateSchemaVersion: exports_external.string().regex(/^v?[0-9]+(?:\.[0-9]+){0,2}$/),
    issuer: primitives.actorPointer,
    keyRef: primitives.resourcePointer,
    signatureRef: primitives.evidencePointer,
    policyResult: exports_external.enum(["passed", "failed"]),
    policyRevision: exports_external.number().int().positive(),
    expiresAt: DeploymentTimestampSchema.nullable().optional(),
    evidenceRefs: exports_external.array(primitives.evidencePointer).min(1)
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    validateChronology(value.createdAt, value.expiresAt, ctx, ["expiresAt"]);
  });
  const ProviderIdentitySchema = exports_external.object({
    accountId: DeploymentIdSchema,
    region: DeploymentNameSchema,
    projectId: DeploymentIdSchema.optional(),
    clusterId: DeploymentIdSchema.optional(),
    networkId: DeploymentIdSchema.optional(),
    storageId: DeploymentIdSchema.optional(),
    routingId: DeploymentIdSchema.optional()
  }).strict().superRefine((value, ctx) => {
    for (const [key, identity] of Object.entries(value)) {
      if (identity && UUID.test(identity)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Provider identity must use provider-issued stable identifiers, not mutable local UUIDs",
          path: [key]
        });
      }
    }
  });
  const EnvironmentBindingSchema = exports_external.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.environmentBinding),
    updatedAt: DeploymentTimestampSchema,
    revision: exports_external.number().int().positive(),
    etag: DeploymentDigestSchema,
    product: ProductProjectionRefSchema,
    intent: IntentSnapshotRefSchema,
    environment: exports_external.object({
      id: DeploymentNameSchema,
      classification: exports_external.enum(["development", "staging", "production", "disaster_recovery"])
    }).strict(),
    dataBackend: exports_external.enum(["sqlite", "postgresql"]),
    providerConnectionRef: primitives.resourcePointer,
    providerCapabilityCard: primitives.providerCapabilityCard,
    providerCapabilityDigest: DeploymentDigestSchema,
    providerIdentity: ProviderIdentitySchema,
    policyProfile: DeploymentNameSchema,
    authorizationProfile: DeploymentNameSchema,
    dataClassification: exports_external.enum(["public", "internal", "private", "sensitive"]),
    backupProfile: DeploymentNameSchema,
    rollbackProfile: DeploymentNameSchema,
    commercialBindingRef: primitives.resourcePointer.optional(),
    writer: primitives.actorPointer,
    changeEvidenceRefs: exports_external.array(primitives.evidencePointer).min(1)
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    if (value.providerCapabilityDigest !== sha256DeploymentValue(value.providerCapabilityCard)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Provider capability digest does not match the pinned capability card",
        path: ["providerCapabilityDigest"]
      });
    }
    if (value.etag !== computeEnvironmentBindingEtag(value.id, value.revision)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Environment ETag does not match id and revision",
        path: ["etag"]
      });
    }
    validateChronology(value.createdAt, value.updatedAt, ctx, ["updatedAt"]);
  });
  const DeploymentRequestKindSchema = exports_external.enum([
    "deployment",
    "promotion",
    "rollback",
    "reconciliation"
  ]);
  const DeploymentRequestSchema = exports_external.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.deploymentRequest),
    kind: DeploymentRequestKindSchema,
    requester: primitives.actorPointer,
    product: ProductProjectionRefSchema,
    environment: EnvironmentBindingRefSchema,
    intent: IntentSnapshotRefSchema,
    artifact: BuildArtifactRefSchema.optional(),
    attestations: exports_external.array(ArtifactAttestationRefSchema).default([]),
    priorReceipt: DeploymentReceiptRefSchema.optional(),
    policyProfile: DeploymentNameSchema,
    idempotencyKeyFingerprint: DeploymentDigestSchema,
    requestAt: DeploymentTimestampSchema,
    expiresAt: DeploymentTimestampSchema.nullable().optional(),
    sourceRequestId: DeploymentIdSchema,
    auditCorrelationId: DeploymentIdSchema,
    costEstimate: primitives.costEstimate.optional(),
    evidenceRefs: exports_external.array(primitives.evidencePointer).min(1)
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    uniqueBy(value.attestations, (ref) => `${ref.id}:${ref.digest}`, ctx, ["attestations"], "Attestation references");
    validateChronology(value.requestAt, value.expiresAt, ctx, ["expiresAt"]);
    if (value.kind === "deployment" && !value.artifact) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Deployment requests require an immutable build artifact",
        path: ["artifact"]
      });
    }
    if ((value.kind === "promotion" || value.kind === "rollback") && !value.priorReceipt) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Promotion and rollback requests require an immutable prior receipt",
        path: ["priorReceipt"]
      });
    }
  });
  const DeploymentInputRefSchema = exports_external.object({
    schema: primitives.schemaId,
    id: DeploymentIdSchema,
    revision: exports_external.number().int().positive().optional(),
    digest: DeploymentDigestSchema
  }).strict();
  const DeploymentActionSchema = exports_external.object({
    id: DeploymentNameSchema,
    operationId: DeploymentOperationIdSchema,
    operationVersion: exports_external.number().int().positive(),
    dependsOn: exports_external.array(DeploymentNameSchema).default([]),
    inputs: exports_external.array(DeploymentInputRefSchema).default([]),
    outputSchema: primitives.schemaId,
    preconditions: exports_external.array(DeploymentNameSchema).default([]),
    postconditions: exports_external.array(DeploymentNameSchema).default([]),
    lockClass: DeploymentNameSchema,
    fencingRequired: exports_external.boolean(),
    sideEffectClass: primitives.providerSideEffectClass,
    riskClass: exports_external.enum(["low", "medium", "high", "critical"]),
    approvalScope: exports_external.enum(["none", "plan", "action", "phase"]),
    runtimeMaterialKind: DeploymentNameSchema.nullable(),
    providerOperation: DeploymentOperationIdSchema.nullable(),
    providerCapabilityDigest: DeploymentDigestSchema.nullable(),
    retryClass: exports_external.enum(["none", "safe", "reconcile_first"]),
    maxAttempts: exports_external.number().int().positive().max(20),
    timeoutClass: DeploymentNameSchema,
    compensationOperationId: DeploymentOperationIdSchema.nullable(),
    idempotencyRequired: exports_external.boolean(),
    reconciliationRequired: exports_external.boolean(),
    evidenceRequirements: exports_external.array(DeploymentNameSchema).min(1)
  }).strict().superRefine((value, ctx) => {
    uniqueBy(value.dependsOn, String, ctx, ["dependsOn"], "Action dependency ids");
    uniqueBy(value.inputs, (input) => `${input.schema}:${input.id}`, ctx, ["inputs"], "Action input identities");
    if (Boolean(value.providerOperation) !== Boolean(value.providerCapabilityDigest)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Provider actions require both operation and capability digest",
        path: value.providerOperation ? ["providerCapabilityDigest"] : ["providerOperation"]
      });
    }
    if (value.sideEffectClass !== "none" && value.sideEffectClass !== "read_only") {
      if (!value.idempotencyRequired) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Side-effecting actions require idempotency",
          path: ["idempotencyRequired"]
        });
      }
      if (!value.reconciliationRequired) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Side-effecting actions require reconciliation",
          path: ["reconciliationRequired"]
        });
      }
      if (!value.compensationOperationId) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Side-effecting actions require compensation or rollback",
          path: ["compensationOperationId"]
        });
      }
    }
    if (value.runtimeMaterialKind && value.approvalScope !== "phase") {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Runtime execution material requires phase-scoped approval",
        path: ["approvalScope"]
      });
    }
  });
  const DeploymentPlanSchema = exports_external.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.deploymentPlan),
    kind: DeploymentRequestKindSchema,
    request: DeploymentRequestRefSchema,
    compiler: exports_external.object({
      actor: primitives.actorPointer,
      version: exports_external.string().trim().min(1),
      contractKitVersion: exports_external.literal(DEPLOYMENT_CONTRACT_VERSION)
    }).strict(),
    inputs: exports_external.array(DeploymentInputRefSchema).min(1),
    providerCapabilityDigests: exports_external.array(DeploymentDigestSchema).default([]),
    actions: exports_external.array(DeploymentActionSchema).min(1),
    authorizationRequirements: exports_external.array(DeploymentNameSchema).default([]),
    policyRequirements: exports_external.array(DeploymentNameSchema).default([]),
    riskClass: exports_external.enum(["low", "medium", "high", "critical"]),
    evidenceRequirements: exports_external.array(DeploymentNameSchema).min(1),
    expectedStateDigest: DeploymentDigestSchema,
    verificationCriteria: exports_external.array(DeploymentNameSchema).min(1),
    rollbackTarget: DeploymentReceiptRefSchema.optional(),
    rollbackInputs: exports_external.array(DeploymentInputRefSchema).default([]),
    estimatedCost: primitives.costEstimate.optional(),
    issuedAt: DeploymentTimestampSchema,
    expiresAt: DeploymentTimestampSchema.nullable().optional()
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    validateChronology(value.issuedAt, value.expiresAt, ctx, ["expiresAt"]);
    uniqueBy(value.inputs, (input) => `${input.schema}:${input.id}`, ctx, ["inputs"], "Plan input identities");
    uniqueBy(value.actions, (action) => action.id, ctx, ["actions"], "Action ids");
    uniqueBy(value.providerCapabilityDigests, String, ctx, ["providerCapabilityDigests"], "Provider capability digests");
    if (!isSorted(value.actions.map((action) => action.id))) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Plan actions must use deterministic lexicographic order",
        path: ["actions"]
      });
    }
    const actionIds = new Set(value.actions.map((action) => action.id));
    const visited = new Set;
    value.actions.forEach((action, index) => {
      for (const dependency of action.dependsOn) {
        if (!actionIds.has(dependency)) {
          ctx.addIssue({
            code: exports_external.ZodIssueCode.custom,
            message: "Action dependency must resolve inside the same plan",
            path: ["actions", index, "dependsOn"]
          });
        } else if (!visited.has(dependency)) {
          ctx.addIssue({
            code: exports_external.ZodIssueCode.custom,
            message: "Action dependencies must precede dependants in deterministic order",
            path: ["actions", index, "dependsOn"]
          });
        }
      }
      visited.add(action.id);
    });
  });
  const RuntimeMaterialBindingSchema = exports_external.object({
    kind: DeploymentNameSchema,
    digest: DeploymentDigestSchema,
    stateLineage: DeploymentIdSchema,
    preActionStateSerial: exports_external.number().int().nonnegative()
  }).strict();
  const DeploymentApprovalDecisionSchema = exports_external.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.deploymentApprovalDecision),
    decision: primitives.decisionEnvelope,
    plan: DeploymentPlanRefSchema,
    scope: exports_external.enum(["plan", "action", "phase"]),
    actionId: DeploymentNameSchema.nullable(),
    phaseId: DeploymentNameSchema.nullable(),
    runtimeMaterial: RuntimeMaterialBindingSchema.nullable(),
    boundInputDigests: exports_external.array(exports_external.object({
      kind: DeploymentNameSchema,
      digest: DeploymentDigestSchema
    }).strict()).min(1),
    environment: EnvironmentBindingRefSchema,
    actorRole: exports_external.enum(["requester", "planner", "approver", "executor", "auditor", "administrator"]),
    attemptScope: exports_external.object({
      minimum: exports_external.number().int().positive(),
      maximum: exports_external.number().int().positive()
    }).strict(),
    unchangedRetryPolicy: exports_external.enum(["allowed", "denied"]),
    issuedAt: DeploymentTimestampSchema,
    expiresAt: DeploymentTimestampSchema,
    separationOfDutiesPassed: exports_external.boolean(),
    authorizationPolicyRevision: exports_external.number().int().positive(),
    evidenceRefs: exports_external.array(primitives.evidencePointer).min(1)
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    validateChronology(value.issuedAt, value.expiresAt, ctx, ["expiresAt"]);
    uniqueBy(value.boundInputDigests, (binding) => binding.kind, ctx, ["boundInputDigests"], "Bound input kinds");
    if (value.decision.decisionType !== "approval") {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Deployment approval decisions must compose an approval DecisionEnvelope",
        path: ["decision", "decisionType"]
      });
    }
    if (value.attemptScope.maximum < value.attemptScope.minimum) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Attempt scope maximum must be greater than or equal to minimum",
        path: ["attemptScope", "maximum"]
      });
    }
    if (value.scope === "plan" && (value.actionId || value.phaseId || value.runtimeMaterial)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Plan-scoped decisions cannot bind action, phase, or runtime material",
        path: ["scope"]
      });
    }
    if (value.scope === "action" && (!value.actionId || value.phaseId || value.runtimeMaterial)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Action-scoped decisions require only an action id",
        path: ["actionId"]
      });
    }
    if (value.scope === "phase" && (!value.actionId || !value.phaseId || !value.runtimeMaterial)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Phase-scoped decisions require action, phase, and runtime material bindings",
        path: ["runtimeMaterial"]
      });
    }
    if (value.decision.status === "allowed" && !value.separationOfDutiesPassed) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Allowed deployment decisions require separation-of-duties evaluation to pass",
        path: ["separationOfDutiesPassed"]
      });
    }
  });
  const AttemptApprovalRefSchema = exports_external.object({
    decision: DeploymentApprovalDecisionRefSchema,
    scope: exports_external.enum(["plan", "action", "phase"]),
    actionId: DeploymentNameSchema.nullable(),
    phaseId: DeploymentNameSchema.nullable(),
    runtimeMaterialDigest: DeploymentDigestSchema.nullable()
  }).strict();
  const AttemptActionStepSchema = exports_external.object({
    sequence: exports_external.number().int().positive(),
    actionId: DeploymentNameSchema,
    state: exports_external.enum(["pending", "running", "succeeded", "failed", "cancelled", "unknown_outcome"]),
    providerCorrelationId: DeploymentIdSchema.nullable(),
    startedAt: DeploymentTimestampSchema.nullable(),
    finishedAt: DeploymentTimestampSchema.nullable(),
    evidenceRefs: DeploymentEvidenceArraySchema
  }).strict().superRefine((value, ctx) => {
    if (value.finishedAt && !value.startedAt) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Finished action steps require a start timestamp",
        path: ["startedAt"]
      });
    }
    if (value.startedAt) {
      validateChronology(value.startedAt, value.finishedAt, ctx, ["finishedAt"]);
    }
  });
  const DeploymentAttemptSchema = exports_external.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.deploymentAttempt),
    updatedAt: DeploymentTimestampSchema,
    revision: exports_external.number().int().positive(),
    plan: DeploymentPlanRefSchema,
    approvals: exports_external.array(AttemptApprovalRefSchema).min(1),
    requester: primitives.actorPointer,
    decisionActors: DeploymentActorArraySchema,
    executorActors: DeploymentActorArraySchema,
    environmentLock: exports_external.object({
      id: DeploymentIdSchema,
      fencingToken: exports_external.number().int().positive()
    }).strict(),
    attemptNumber: exports_external.number().int().positive(),
    retryOf: DeploymentAttemptRefSchema.nullable(),
    state: exports_external.enum(["queued", "running", "reconciling", "unknown_outcome", "succeeded", "failed", "cancelled"]),
    actionSteps: exports_external.array(AttemptActionStepSchema).min(1),
    outboxCorrelationRef: primitives.resourcePointer,
    inboxCorrelationRef: primitives.resourcePointer,
    failureReason: exports_external.string().trim().min(1).nullable(),
    evidenceRefs: DeploymentEvidenceArraySchema,
    providerReceipts: exports_external.array(ProviderReceiptRefSchema).default([]),
    finalReceipt: DeploymentReceiptRefSchema.nullable()
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    validateChronology(value.createdAt, value.updatedAt, ctx, ["updatedAt"]);
    uniqueBy(value.approvals, (approval) => approval.decision.id, ctx, ["approvals"], "Approval decision ids");
    uniqueBy(value.decisionActors, (actor) => `${actor.kind}:${actor.id}`, ctx, ["decisionActors"], "Decision actor identities");
    uniqueBy(value.executorActors, (actor) => `${actor.kind}:${actor.id}`, ctx, ["executorActors"], "Executor actor identities");
    uniqueBy(value.actionSteps, (step) => step.actionId, ctx, ["actionSteps"], "Attempt action ids");
    uniqueBy(value.actionSteps, (step) => String(step.sequence), ctx, ["actionSteps"], "Attempt action sequences");
    if (!isSorted(value.actionSteps.map((step) => String(step.sequence).padStart(10, "0")))) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Attempt action steps must be in ascending sequence order",
        path: ["actionSteps"]
      });
    }
    if ((value.state === "failed" || value.state === "cancelled" || value.state === "unknown_outcome") && !value.failureReason) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Failed, cancelled, and unknown-outcome attempts require a reason",
        path: ["failureReason"]
      });
    }
    if (value.state !== "succeeded" && value.finalReceipt) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Only succeeded attempts may bind a final deployment receipt",
        path: ["finalReceipt"]
      });
    }
  });
  const ProviderReceiptSchema = exports_external.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.providerReceipt),
    attempt: DeploymentAttemptRefSchema,
    provider: DeploymentNameSchema,
    adapter: DeploymentNameSchema,
    connectionRef: primitives.resourcePointer,
    capabilityDigest: DeploymentDigestSchema,
    operationId: DeploymentOperationIdSchema,
    operationVersion: exports_external.number().int().positive(),
    providerIdentity: exports_external.object({
      projectId: DeploymentIdSchema.nullable(),
      operationId: DeploymentIdSchema,
      deploymentId: DeploymentIdSchema.nullable(),
      resourceIds: exports_external.array(DeploymentIdSchema).default([]),
      eventId: DeploymentIdSchema.nullable()
    }).strict(),
    requestFingerprint: DeploymentDigestSchema,
    providerStatus: DeploymentNameSchema,
    normalizedResult: exports_external.enum(["accepted", "succeeded", "failed", "cancelled", "unknown"]),
    observedProviderRevision: DeploymentIdSchema.nullable(),
    observedAt: DeploymentTimestampSchema,
    retryClass: exports_external.enum(["none", "safe", "reconcile_first"]),
    reconciliationState: exports_external.enum(["not_required", "pending", "confirmed", "diverged"]),
    unknownOutcome: exports_external.boolean(),
    redaction: exports_external.enum(["none", "partial", "full"]),
    responseEvidenceRefs: exports_external.array(primitives.evidencePointer).min(1),
    observationEvidenceRefs: DeploymentEvidenceArraySchema
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    const providerIds = [
      value.providerIdentity.projectId,
      value.providerIdentity.operationId,
      value.providerIdentity.deploymentId,
      value.providerIdentity.eventId,
      ...value.providerIdentity.resourceIds
    ].filter((identity) => Boolean(identity));
    providerIds.forEach((identity, index) => {
      if (UUID.test(identity)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Provider receipts require provider-issued identities, not mutable local UUIDs",
          path: ["providerIdentity", index]
        });
      }
    });
    uniqueBy(value.providerIdentity.resourceIds, String, ctx, ["providerIdentity", "resourceIds"], "Provider resource ids");
    if (value.normalizedResult === "succeeded" && value.observationEvidenceRefs.length === 0) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Provider success requires later observation evidence",
        path: ["observationEvidenceRefs"]
      });
    }
    if (value.unknownOutcome !== (value.normalizedResult === "unknown")) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "unknownOutcome must agree with normalizedResult",
        path: ["unknownOutcome"]
      });
    }
  });
  const VerificationCheckSchema = exports_external.object({
    id: DeploymentNameSchema,
    kind: exports_external.enum(["health", "readiness", "version", "migration", "alarm", "access", "restore", "rollback", "security", "contract"]),
    status: exports_external.enum(["passed", "failed", "missing", "expired", "blocked"]),
    evidenceRefs: exports_external.array(primitives.evidencePointer).min(1)
  }).strict();
  const DeploymentReceiptSchema = exports_external.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.deploymentReceipt),
    request: DeploymentRequestRefSchema,
    plan: DeploymentPlanRefSchema,
    approvals: exports_external.array(DeploymentApprovalDecisionRefSchema).min(1),
    attempt: DeploymentAttemptRefSchema,
    product: ProductProjectionRefSchema,
    intent: IntentSnapshotRefSchema,
    artifact: BuildArtifactRefSchema,
    attestations: exports_external.array(ArtifactAttestationRefSchema).min(1),
    environment: EnvironmentBindingRefSchema,
    providerReceipts: exports_external.array(ProviderReceiptRefSchema).min(1),
    desiredStateDigest: DeploymentDigestSchema,
    observedStateDigest: DeploymentDigestSchema,
    verification: exports_external.array(VerificationCheckSchema).min(1),
    infrastructurePlanRef: primitives.evidencePointer.optional(),
    infrastructureStateLineageRef: primitives.resourcePointer.optional(),
    rollbackTarget: DeploymentReceiptRefSchema.optional(),
    verifiers: DeploymentActorArraySchema,
    evidenceRefs: exports_external.array(primitives.evidencePointer).min(1),
    outcome: exports_external.enum(["succeeded", "failed", "cancelled", "unknown_outcome"])
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    uniqueBy(value.approvals, (approval) => approval.id, ctx, ["approvals"], "Receipt approval ids");
    uniqueBy(value.attestations, (attestation) => attestation.id, ctx, ["attestations"], "Receipt attestation ids");
    uniqueBy(value.providerReceipts, (receipt) => receipt.id, ctx, ["providerReceipts"], "Provider receipt ids");
    uniqueBy(value.verification, (check2) => check2.id, ctx, ["verification"], "Verification check ids");
    uniqueBy(value.verifiers, (actor) => `${actor.kind}:${actor.id}`, ctx, ["verifiers"], "Receipt verifier identities");
    if (value.outcome === "succeeded" && value.verification.some((check2) => check2.status !== "passed")) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Succeeded deployment receipts require every verification check to pass",
        path: ["verification"]
      });
    }
  });
  const LaunchFindingSchema = exports_external.object({
    id: DeploymentNameSchema,
    severity: exports_external.enum(["p0", "p1", "p2", "p3"]),
    status: exports_external.enum(["open", "resolved", "accepted"]),
    evidenceRefs: exports_external.array(primitives.evidencePointer).min(1)
  }).strict();
  const LaunchEvidenceSchema = exports_external.object({
    ...recordBase(DEPLOYMENT_SCHEMA_IDS.launchEvidence),
    product: ProductProjectionRefSchema,
    environment: EnvironmentBindingRefSchema,
    deploymentReceipt: DeploymentReceiptRefSchema,
    requiredChecks: exports_external.array(VerificationCheckSchema).min(1),
    proofBundleRefs: exports_external.array(primitives.resourcePointer).min(1),
    findings: exports_external.array(LaunchFindingSchema).default([]),
    verifiers: DeploymentActorArraySchema,
    independentReview: exports_external.boolean(),
    status: exports_external.enum(["candidate", "blocked", "ready", "launched", "rolled_back"]),
    compiledAt: DeploymentTimestampSchema,
    expiresAt: DeploymentTimestampSchema
  }).strict().superRefine((value, ctx) => {
    validateDeploymentRecord(value, ctx);
    uniqueBy(value.requiredChecks, (check2) => check2.id, ctx, ["requiredChecks"], "Launch check ids");
    uniqueBy(value.findings, (finding) => finding.id, ctx, ["findings"], "Launch finding ids");
    uniqueBy(value.verifiers, (actor) => `${actor.kind}:${actor.id}`, ctx, ["verifiers"], "Launch verifier identities");
    validateChronology(value.compiledAt, value.expiresAt, ctx, ["expiresAt"]);
    if ((value.status === "ready" || value.status === "launched") && (value.requiredChecks.some((check2) => check2.status !== "passed") || value.findings.some((finding) => (finding.severity === "p0" || finding.severity === "p1") && finding.status === "open") || !value.independentReview)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Ready and launched evidence requires passing checks, no open P0/P1 findings, and independent review",
        path: ["status"]
      });
    }
  });
  const DeploymentSchemaRegistry = Object.freeze({
    [DEPLOYMENT_SCHEMA_IDS.productProjection]: ProductProjectionSchema,
    [DEPLOYMENT_SCHEMA_IDS.intentSnapshot]: IntentSnapshotSchema,
    [DEPLOYMENT_SCHEMA_IDS.verifiedSourceCandidate]: VerifiedSourceCandidateSchema,
    [DEPLOYMENT_SCHEMA_IDS.buildArtifact]: BuildArtifactSchema,
    [DEPLOYMENT_SCHEMA_IDS.artifactAttestation]: ArtifactAttestationSchema,
    [DEPLOYMENT_SCHEMA_IDS.environmentBinding]: EnvironmentBindingSchema,
    [DEPLOYMENT_SCHEMA_IDS.deploymentRequest]: DeploymentRequestSchema,
    [DEPLOYMENT_SCHEMA_IDS.deploymentPlan]: DeploymentPlanSchema,
    [DEPLOYMENT_SCHEMA_IDS.deploymentApprovalDecision]: DeploymentApprovalDecisionSchema,
    [DEPLOYMENT_SCHEMA_IDS.deploymentAttempt]: DeploymentAttemptSchema,
    [DEPLOYMENT_SCHEMA_IDS.providerReceipt]: ProviderReceiptSchema,
    [DEPLOYMENT_SCHEMA_IDS.deploymentReceipt]: DeploymentReceiptSchema,
    [DEPLOYMENT_SCHEMA_IDS.launchEvidence]: LaunchEvidenceSchema
  });
  return {
    ProductProjectionRefSchema,
    IntentSnapshotRefSchema,
    VerifiedSourceCandidateRefSchema,
    BuildArtifactRefSchema,
    ArtifactAttestationRefSchema,
    EnvironmentBindingRefSchema,
    DeploymentRequestRefSchema,
    DeploymentPlanRefSchema,
    DeploymentApprovalDecisionRefSchema,
    DeploymentAttemptRefSchema,
    ProviderReceiptRefSchema,
    DeploymentReceiptRefSchema,
    ProductProjectionSchema,
    IntentSnapshotSchema,
    VerifiedSourceCandidateSchema,
    BuildArtifactSchema,
    ArtifactAttestationSchema,
    EnvironmentBindingSchema,
    DeploymentRequestSchema,
    DeploymentActionSchema,
    DeploymentPlanSchema,
    DeploymentApprovalDecisionSchema,
    DeploymentAttemptSchema,
    ProviderReceiptSchema,
    DeploymentReceiptSchema,
    LaunchEvidenceSchema,
    DeploymentSchemaRegistry
  };
}

// src/deployment-envelope.ts
var DEPLOYMENT_ENVELOPE_SCHEMA_ID = "hasna.deployment_envelope.v1";
var DEPLOYMENT_ENVELOPE_RATIFICATION_GATE = "one production deployment executed through this envelope with receipts and a passed live test";
var CANONICAL_RESOURCE_KINDS = [
  "compute",
  "database",
  "object_storage",
  "cache",
  "queue",
  "topic",
  "worker",
  "cron",
  "function",
  "secret",
  "domain",
  "dns",
  "cdn",
  "network",
  "identity",
  "observability",
  "other"
];
var RESOURCE_KIND_SOURCE_VOCABULARIES = [
  "deployment_db",
  "app_cloud",
  "intent",
  "aws_plan"
];
var RESOURCE_KIND_MAPPINGS = {
  deployment_db: {
    database: "database",
    cache: "cache",
    storage: "object_storage",
    domain: "domain",
    compute: "compute",
    queue: "queue",
    cdn: "cdn",
    dns: "dns"
  },
  app_cloud: {
    database: "database",
    bucket: "object_storage",
    object_store: "object_storage",
    queue: "queue",
    secret: "secret",
    function: "function",
    worker: "worker",
    cache: "cache",
    topic: "topic",
    scheduler: "cron",
    other: "other"
  },
  intent: {
    database: "database",
    object_storage: "object_storage",
    queue: "queue",
    cron: "cron",
    worker: "worker"
  },
  aws_plan: {
    "ecs-cluster": "compute",
    "ecs-task-definition": "compute",
    "ecs-service": "compute",
    "rds-postgres": "database",
    "s3-bucket": "object_storage",
    "iam-task-role": "identity",
    "iam-execution-role": "identity",
    "cloudwatch-log-group": "observability",
    "vpc-networking": "network",
    "security-group": "network"
  }
};
var ENVIRONMENT_ALIAS_MAP = {
  dev: "development",
  staging: "staging",
  prod: "production"
};
var ENVELOPE_PROVIDERS = [
  "aws",
  "gcp",
  "azure",
  "cloudflare",
  "vercel",
  "railway",
  "flyio",
  "digitalocean",
  "other"
];
var ACCOUNT_BOUND_PROVIDERS = new Set([
  "aws",
  "gcp",
  "azure"
]);
var ENVELOPE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
var ENVELOPE_NAME = /^[a-z][a-z0-9._-]{0,127}$/;
var ENVELOPE_OPERATION_ID = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
function uniqueEnvelopeBy(values, key, ctx, path, label) {
  const seen = new Set;
  values.forEach((value, index) => {
    const semanticId = key(value);
    if (seen.has(semanticId)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `${label} must be unique`,
        path: [...path, index]
      });
    }
    seen.add(semanticId);
  });
}
function createDeploymentEnvelopeSchema(primitives) {
  const EnvelopeIdSchema = exports_external.string().regex(ENVELOPE_ID);
  const EnvelopeNameSchema = exports_external.string().regex(ENVELOPE_NAME);
  const EnvelopeOperationIdSchema = exports_external.string().regex(ENVELOPE_OPERATION_ID);
  const EnvelopeTimestampSchema = primitives.timestamp;
  const EnvelopeMetadataSchema = primitives.metadata;
  const EnvelopeUriSchema = primitives.uri;
  const EnvelopeResourcePointerSchema = primitives.resourcePointer;
  const EnvelopeEvidencePointerSchema = primitives.evidencePointer;
  const envelopeBase = (schema) => ({
    schema: exports_external.literal(schema),
    id: EnvelopeIdSchema,
    createdAt: EnvelopeTimestampSchema,
    updatedAt: EnvelopeTimestampSchema.nullable().optional(),
    metadata: EnvelopeMetadataSchema.optional()
  });
  const EnvelopeResourceSchema = exports_external.object({
    id: EnvelopeNameSchema,
    provider: exports_external.enum(ENVELOPE_PROVIDERS),
    kind: exports_external.enum(CANONICAL_RESOURCE_KINDS),
    sourceVocabulary: exports_external.enum(RESOURCE_KIND_SOURCE_VOCABULARIES).optional(),
    sourceKind: exports_external.string().trim().min(1).optional(),
    ownerPackage: primitives.npmPackageName,
    region: exports_external.string().trim().min(1).optional(),
    accountId: exports_external.string().trim().min(1).optional(),
    uri: EnvelopeUriSchema.optional(),
    dependsOn: exports_external.array(EnvelopeNameSchema).default([]),
    desiredConfig: exports_external.record(exports_external.unknown()).default({})
  }).strict().superRefine((value, ctx) => {
    if (Boolean(value.sourceVocabulary) !== Boolean(value.sourceKind)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "sourceVocabulary and sourceKind must be declared together",
        path: ["sourceKind"]
      });
    }
    if (value.sourceVocabulary && value.sourceKind) {
      const mapping = RESOURCE_KIND_MAPPINGS[value.sourceVocabulary];
      if (!mapping) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Unknown resource-kind source vocabulary",
          path: ["sourceVocabulary"]
        });
      } else if (!(value.sourceKind in mapping)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: `Unmapped resource kind ${value.sourceKind} in vocabulary ${value.sourceVocabulary}; unmapped kinds are rejected, never guessed`,
          path: ["sourceKind"]
        });
      } else {
        const mapped = mapping[value.sourceKind];
        if (mapped !== value.kind) {
          ctx.addIssue({
            code: exports_external.ZodIssueCode.custom,
            message: `Resource kind ${value.sourceKind} in vocabulary ${value.sourceVocabulary} maps to canonical kind ${mapped}, not ${value.kind}`,
            path: ["kind"]
          });
        }
      }
    }
    if (ACCOUNT_BOUND_PROVIDERS.has(value.provider) && !value.accountId) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `Provider ${value.provider} is account-bound and requires an accountId`,
        path: ["accountId"]
      });
    }
    if (!ACCOUNT_BOUND_PROVIDERS.has(value.provider)) {
      if (!value.accountId && !value.uri && !value.region) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: `Provider ${value.provider} requires at least one of accountId, uri, or region`,
          path: ["provider"]
        });
      }
    }
  });
  const EnvelopeEnvironmentSchema = exports_external.object({
    id: EnvelopeNameSchema,
    classification: exports_external.enum([
      "development",
      "staging",
      "production",
      "disaster_recovery"
    ]),
    legacyAlias: exports_external.enum(["dev", "staging", "prod"]).optional(),
    binding: primitives.environmentBindingRef,
    desiredConfig: exports_external.record(exports_external.unknown()).default({})
  }).strict().superRefine((value, ctx) => {
    if (value.legacyAlias) {
      const mapped = ENVIRONMENT_ALIAS_MAP[value.legacyAlias];
      if (mapped !== value.classification) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: `Legacy alias ${value.legacyAlias} maps to canonical classification ${mapped}, not ${value.classification}`,
          path: ["legacyAlias"]
        });
      }
    }
  });
  const EnvelopeActionSchema = exports_external.object({
    id: EnvelopeNameSchema,
    operationId: EnvelopeOperationIdSchema,
    sideEffectClass: primitives.providerSideEffectClass,
    compensationOperationId: EnvelopeOperationIdSchema.nullable().optional(),
    nonReversible: exports_external.boolean().default(false),
    approvalScope: exports_external.enum(["none", "action", "phase"]).default("action"),
    evidenceRequirement: exports_external.string().trim().min(1).optional()
  }).strict();
  const EnvelopePhaseSchema = exports_external.object({
    id: EnvelopeNameSchema,
    approvalScope: exports_external.enum(["none", "plan", "action", "phase"]),
    actions: exports_external.array(EnvelopeActionSchema).min(1)
  }).strict();
  const EnvelopeMonitorCheckSchema = exports_external.object({
    id: EnvelopeNameSchema,
    kind: exports_external.enum([
      "availability",
      "deployment",
      "host",
      "process",
      "tls",
      "domain_expiry",
      "health",
      "readiness"
    ]),
    endpoint: EnvelopeUriSchema.optional(),
    expectedStatuses: exports_external.array(exports_external.number().int().min(100).max(599)).default([]),
    alarmClass: EnvelopeNameSchema.optional()
  }).strict();
  const DeploymentEnvelopeSchema = exports_external.object({
    ...envelopeBase(DEPLOYMENT_ENVELOPE_SCHEMA_ID),
    status: exports_external.enum(["draft", "active"]).default("draft"),
    ratification: exports_external.object({
      gate: exports_external.literal(DEPLOYMENT_ENVELOPE_RATIFICATION_GATE),
      satisfied: exports_external.boolean().default(false),
      evidenceRefs: exports_external.array(EnvelopeEvidencePointerSchema).default([])
    }).strict(),
    contractKitVersion: exports_external.literal(DEPLOYMENT_CONTRACT_VERSION),
    identity: exports_external.object({
      appId: primitives.appId,
      packageName: primitives.npmPackageName,
      projectsRef: EnvelopeResourcePointerSchema,
      repositoryRef: EnvelopeResourcePointerSchema
    }).strict(),
    audience: exports_external.enum(["internal", "products"]),
    accountMapping: exports_external.array(exports_external.object({
      audience: exports_external.enum(["internal", "products"]),
      accountId: exports_external.string().trim().min(1),
      region: exports_external.string().trim().min(1).optional(),
      purpose: exports_external.string().trim().min(1).optional()
    }).strict()).min(1),
    environments: exports_external.array(EnvelopeEnvironmentSchema).min(1),
    resourceGraph: exports_external.object({
      resources: exports_external.array(EnvelopeResourceSchema).min(1)
    }).strict(),
    artifacts: exports_external.array(primitives.buildArtifactRef).default([]),
    deployProcedure: exports_external.object({
      requestKind: exports_external.enum([
        "deployment",
        "promotion",
        "rollback",
        "reconciliation"
      ]),
      plan: primitives.deploymentPlanRef,
      phases: exports_external.array(EnvelopePhaseSchema).min(1)
    }).strict(),
    monitorWiring: exports_external.object({
      source: exports_external.enum(["uptime", "monitor", "fleet", "none"]),
      importMode: exports_external.enum(["link_only", "active"]).default("link_only"),
      checks: exports_external.array(EnvelopeMonitorCheckSchema).default([])
    }).strict(),
    rollback: exports_external.object({
      profile: EnvelopeNameSchema,
      targetReceipt: primitives.deploymentReceiptRef.optional()
    }).strict()
  }).strict().superRefine((value, ctx) => {
    addDeploymentSafetyIssues(value, ctx);
    if (value.status === "active") {
      if (!value.ratification.satisfied) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Active envelopes require the ratification gate to be satisfied",
          path: ["ratification", "satisfied"]
        });
      }
      if (value.ratification.evidenceRefs.length === 0) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Active envelopes require ratification evidence refs",
          path: ["ratification", "evidenceRefs"]
        });
      }
    }
    if (value.identity.projectsRef.kind !== "project") {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "The envelope requires a resolved Hasna Projects identity (projectsRef.kind must be project)",
        path: ["identity", "projectsRef", "kind"]
      });
    }
    uniqueEnvelopeBy(value.environments, (environment) => environment.id, ctx, ["environments"], "Environment ids");
    uniqueEnvelopeBy(value.accountMapping, (mapping) => mapping.audience, ctx, ["accountMapping"], "Account mapping audiences");
    uniqueEnvelopeBy(value.resourceGraph.resources, (resource) => resource.id, ctx, ["resourceGraph", "resources"], "Resource ids");
    const resourceIds = new Set(value.resourceGraph.resources.map((resource) => resource.id));
    value.resourceGraph.resources.forEach((resource, index) => {
      for (const dependency of resource.dependsOn) {
        if (!resourceIds.has(dependency)) {
          ctx.addIssue({
            code: exports_external.ZodIssueCode.custom,
            message: "Resource dependency must resolve inside the graph",
            path: ["resourceGraph", "resources", index, "dependsOn"]
          });
        }
      }
    });
    uniqueEnvelopeBy(value.deployProcedure.phases, (phase) => phase.id, ctx, ["deployProcedure", "phases"], "Procedure phase ids");
    value.deployProcedure.phases.forEach((phase, phaseIndex) => {
      uniqueEnvelopeBy(phase.actions, (action) => action.id, ctx, ["deployProcedure", "phases", phaseIndex, "actions"], "Procedure action ids");
      phase.actions.forEach((action, actionIndex) => {
        const actionPath = [
          "deployProcedure",
          "phases",
          phaseIndex,
          "actions",
          actionIndex
        ];
        const sideEffectClass = String(action.sideEffectClass);
        if (sideEffectClass !== "none" && sideEffectClass !== "read_only" && !action.compensationOperationId && action.nonReversible !== true) {
          ctx.addIssue({
            code: exports_external.ZodIssueCode.custom,
            message: "Side-effecting procedure actions require a compensation operation or an explicit non-reversible classification",
            path: [...actionPath, "compensationOperationId"]
          });
        }
      });
    });
  });
  return {
    DeploymentEnvelopeSchema,
    EnvelopeResourceSchema,
    EnvelopeEnvironmentSchema,
    EnvelopePhaseSchema,
    EnvelopeActionSchema
  };
}

// src/schemas.ts
var CONTRACTS_PACKAGE_VERSION = "1.0.1";
var SCHEMA_IDS = {
  actorRef: "hasna.actor_ref.v1",
  resourceRef: "hasna.resource_ref.v1",
  evidenceRef: "hasna.evidence_ref.v1",
  workRun: "hasna.work_run.v1",
  taskToPrProjection: "hasna.task_to_pr_projection.v1",
  decisionEnvelope: "hasna.decision_envelope.v1",
  costEstimate: "hasna.cost_estimate.v1",
  capabilityCard: "hasna.capability_card.v1",
  providerLiveModeStandard: "hasna.provider_live_mode_standard.v1",
  contextPack: "hasna.context_pack.v1",
  integrationRef: "hasna.integration_ref.v1",
  projectManifest: "hasna.project_manifest.v1",
  projectPanel: "hasna.project_panel.v1",
  projectSnapshot: "hasna.project_snapshot.v1",
  renderManifest: "hasna.render_manifest.v1",
  agentTrajectory: "hasna.agent_trajectory.v1",
  validationPlan: "hasna.validation_plan.v1",
  proofBundle: "hasna.proof_bundle.v1",
  scaffoldManifest: "hasna.scaffold_manifest.v1",
  scaffoldInstallRecord: "hasna.scaffold_install_record.v1",
  appCloudManifest: "hasna.app_cloud_manifest.v1",
  deploymentEnvelope: "hasna.deployment_envelope.v1",
  noCloudEvidencePack: "hasna.no_cloud_evidence_pack.v1",
  secureLocalStorePolicy: "hasna.secure_local_store_policy.v1",
  serviceContract: "hasna.service_contract.v1",
  commsEventEnvelope: "hasna.comms_event_envelope.v1",
  commsChannelMetadata: "hasna.comms_channel_metadata.v1",
  commsMessageMetadata: "hasna.comms_message_metadata.v1",
  projectResourceLinkCollectionV1: "hasna.project_resource_link_collection.v1",
  app: "hasna.app.v1",
  release: "hasna.release.v1",
  rolloutRecord: "hasna.rollout_record.v1",
  announcement: "hasna.announcement.v1",
  audience: "hasna.audience.v1"
};
var SchemaIdSchema = exports_external.string().regex(/^hasna\.[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*\.v[0-9]+$/);
var TimestampSchema = exports_external.string().datetime();
var NonEmptyStringSchema = exports_external.string().trim().min(1);
var UriSchema = NonEmptyStringSchema.refine((value) => value.startsWith("artifact://") || value.startsWith("repo://") || value.startsWith("project://") || value.startsWith("dashboard://") || value.startsWith("render://") || value.startsWith("integration://") || value.startsWith("task://") || value.startsWith("todo://") || value.startsWith("file://") || value.startsWith("files://") || value.startsWith("mailery://") || value.startsWith("conversation://") || value.startsWith("knowledge://") || value.startsWith("memento://") || value.startsWith("https://") || value.startsWith("http://") || value.startsWith("git+https://"), "URI must use artifact://, repo://, project://, dashboard://, render://, integration://, task://, todo://, file://, files://, mailery://, conversation://, knowledge://, memento://, http(s)://, or git+https://");
var Sha256DigestSchema = exports_external.string().regex(/^[a-fA-F0-9]{64}$/);
var HashStringSchema = exports_external.string().regex(/^(sha256:)?[a-fA-F0-9]{64}$/);
var MetadataSchema = exports_external.record(exports_external.unknown());
var TagsSchema = exports_external.array(exports_external.string().min(1)).default([]);
var OptionalTimestampSchema = TimestampSchema.nullable().optional();
var TerminalStatuses = new Set(["succeeded", "failed", "cancelled", "blocked", "skipped"]);
var ContractStatusSchema = exports_external.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "blocked",
  "skipped",
  "unknown"
]);
function contractBaseSchema(schema) {
  return exports_external.object({
    schema: exports_external.literal(schema),
    id: exports_external.string().min(1),
    createdAt: TimestampSchema,
    updatedAt: OptionalTimestampSchema,
    metadata: MetadataSchema.optional()
  }).strict();
}
var ContractEnvelopeSchema = exports_external.object({
  schema: SchemaIdSchema,
  id: exports_external.string().min(1),
  createdAt: TimestampSchema,
  updatedAt: OptionalTimestampSchema,
  metadata: MetadataSchema.optional()
}).strict();
var ActorKindSchema = exports_external.enum([
  "agent",
  "human",
  "service",
  "model",
  "workflow",
  "system"
]);
var ActorRefSchema = contractBaseSchema(SCHEMA_IDS.actorRef).extend({
  kind: ActorKindSchema,
  name: exports_external.string().min(1).optional(),
  provider: exports_external.string().min(1).optional(),
  accountId: exports_external.string().min(1).optional(),
  machineId: exports_external.string().min(1).optional(),
  capabilities: exports_external.array(exports_external.string().min(1)).default([])
}).strict();
var ActorPointerSchema = exports_external.object({
  kind: ActorKindSchema,
  id: exports_external.string().min(1),
  name: exports_external.string().min(1).optional(),
  provider: exports_external.string().min(1).optional(),
  accountId: exports_external.string().min(1).optional(),
  machineId: exports_external.string().min(1).optional()
}).strict();
var ResourceKindSchema = exports_external.enum([
  "task",
  "project",
  "repo",
  "run",
  "loop",
  "workflow",
  "action",
  "event",
  "integration",
  "session",
  "machine",
  "model",
  "tool",
  "file",
  "document",
  "url",
  "artifact",
  "knowledge",
  "email",
  "conversation",
  "dashboard",
  "render",
  "panel",
  "report",
  "commit",
  "branch",
  "pull_request",
  "issue",
  "comment",
  "verification",
  "finding",
  "context_pack",
  "proof_bundle",
  "memento",
  "eval",
  "budget",
  "cost",
  "alert",
  "incident",
  "app",
  "release",
  "rollout",
  "announcement",
  "audience",
  "feedback",
  "unknown"
]);
var ResourceRefSchema = contractBaseSchema(SCHEMA_IDS.resourceRef).extend({
  kind: ResourceKindSchema,
  name: exports_external.string().min(1).optional(),
  uri: UriSchema.optional(),
  externalId: NonEmptyStringSchema.optional(),
  sourcePackage: NonEmptyStringSchema.optional(),
  tags: TagsSchema
}).strict().superRefine((value, ctx) => {
  if (!value.uri && !(value.externalId && value.sourcePackage)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Resource refs require uri or both sourcePackage and externalId",
      path: ["uri"]
    });
  }
});
var ResourcePointerSchema = exports_external.object({
  kind: ResourceKindSchema,
  id: exports_external.string().min(1),
  name: exports_external.string().min(1).optional(),
  uri: UriSchema.optional(),
  externalId: NonEmptyStringSchema.optional(),
  sourcePackage: NonEmptyStringSchema.optional(),
  tags: TagsSchema
}).strict().superRefine((value, ctx) => {
  if (!value.uri && Boolean(value.externalId) !== Boolean(value.sourcePackage)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Resource pointers with external package locators require both sourcePackage and externalId",
      path: value.externalId ? ["sourcePackage"] : ["externalId"]
    });
  }
});
var EvidenceKindSchema = exports_external.enum([
  "file",
  "command_output",
  "screenshot",
  "log",
  "diff",
  "report",
  "artifact",
  "url",
  "video",
  "har",
  "test_result",
  "metric",
  "trace",
  "other"
]);
var RedactionStateSchema = exports_external.enum(["none", "partial", "full", "unknown"]);
var EvidenceRefSchema = contractBaseSchema(SCHEMA_IDS.evidenceRef).extend({
  kind: EvidenceKindSchema,
  uri: UriSchema,
  sha256: Sha256DigestSchema.optional(),
  summary: exports_external.string().min(1).optional(),
  contentType: exports_external.string().min(1).optional(),
  sizeBytes: exports_external.number().int().nonnegative().optional(),
  redaction: RedactionStateSchema.default("unknown"),
  producer: ActorPointerSchema.optional(),
  resourceRefs: exports_external.array(ResourcePointerSchema).default([]),
  tags: TagsSchema
}).strict();
var EvidencePointerSchema = exports_external.object({
  id: exports_external.string().min(1),
  kind: EvidenceKindSchema.optional(),
  uri: UriSchema.optional(),
  sha256: Sha256DigestSchema.optional(),
  summary: exports_external.string().min(1).optional()
}).strict();
var CostEstimateSchema = contractBaseSchema(SCHEMA_IDS.costEstimate).extend({
  currency: exports_external.string().regex(/^[A-Z]{3}$/).default("USD"),
  amountMicros: exports_external.number().int().nonnegative(),
  provider: exports_external.string().min(1).optional(),
  model: exports_external.string().min(1).optional(),
  accountId: exports_external.string().min(1).optional(),
  promptTokens: exports_external.number().int().nonnegative().optional(),
  completionTokens: exports_external.number().int().nonnegative().optional(),
  totalTokens: exports_external.number().int().nonnegative().optional(),
  basis: exports_external.enum(["actual", "estimated", "budget", "limit"]).default("estimated"),
  resourceRefs: exports_external.array(ResourcePointerSchema).default([])
}).strict().superRefine((value, ctx) => {
  if (value.promptTokens !== undefined && value.completionTokens !== undefined && value.totalTokens !== undefined && value.totalTokens !== value.promptTokens + value.completionTokens) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "totalTokens must equal promptTokens plus completionTokens when all are present",
      path: ["totalTokens"]
    });
  }
});
var DecisionStatusSchema = exports_external.enum([
  "allowed",
  "denied",
  "warned",
  "approval_required",
  "selected",
  "skipped",
  "unknown"
]);
var DecisionEnvelopeSchema = contractBaseSchema(SCHEMA_IDS.decisionEnvelope).extend({
  decisionType: exports_external.enum([
    "guardrail",
    "model_route",
    "tool_select",
    "budget",
    "secret_access",
    "approval",
    "policy",
    "other"
  ]),
  status: DecisionStatusSchema,
  actor: ActorPointerSchema.optional(),
  traceId: exports_external.string().min(1).optional(),
  inputHash: HashStringSchema.optional(),
  policyBundleId: exports_external.string().min(1).optional(),
  selected: exports_external.array(ResourcePointerSchema).default([]),
  skipped: exports_external.array(ResourcePointerSchema).default([]),
  reason: exports_external.string().min(1),
  obligations: exports_external.array(exports_external.string().min(1)).default([]),
  redactions: exports_external.array(exports_external.string().min(1)).default([]),
  costEstimate: CostEstimateSchema.optional(),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([])
}).strict().superRefine((value, ctx) => {
  if (value.status === "selected" && value.selected.length === 0) {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Selected decisions require at least one selected resource", path: ["selected"] });
  }
  if (value.status === "skipped" && value.skipped.length === 0) {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Skipped decisions require at least one skipped resource", path: ["skipped"] });
  }
  if (value.status === "denied") {
    if (value.selected.length > 0) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Denied decisions cannot include selected resources", path: ["selected"] });
    }
    if (!value.policyBundleId && value.evidenceRefs.length === 0 && value.obligations.length === 0) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Denied decisions require policy, evidence, or obligations",
        path: ["policyBundleId"]
      });
    }
  }
  if (value.status === "approval_required" && value.obligations.length === 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Approval-required decisions require actionable obligations",
      path: ["obligations"]
    });
  }
});
var CapabilityCardSchema = contractBaseSchema(SCHEMA_IDS.capabilityCard).extend({
  kind: exports_external.enum(["model", "tool", "machine", "agent", "lane", "connector", "service"]),
  name: exports_external.string().min(1),
  version: exports_external.string().min(1).optional(),
  status: exports_external.enum(["available", "unavailable", "degraded", "unknown"]).default("unknown"),
  capabilities: exports_external.array(exports_external.string().min(1)).default([]),
  limitations: exports_external.array(exports_external.string().min(1)).default([]),
  riskLevel: exports_external.enum(["low", "medium", "high", "critical", "unknown"]).default("unknown"),
  costEstimate: CostEstimateSchema.optional(),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([])
}).strict();
var ProviderModeSchema = exports_external.enum(["mock", "fixture", "sandbox", "read_only_live", "live_mutating"]);
var ProviderSideEffectClassSchema = exports_external.enum([
  "none",
  "read_only",
  "external_notification",
  "external_mutation",
  "money_movement",
  "dns_or_domain_change",
  "bulk_message_or_call",
  "legal_or_filing",
  "compute_or_infra_mutation",
  "irreversible"
]);
var CredentialRequirementSchema = exports_external.object({
  refName: NonEmptyStringSchema,
  requiredForModes: exports_external.array(ProviderModeSchema).min(1),
  allowedSecretInputs: exports_external.array(exports_external.enum(["credential_ref", "lease_ref"])).min(1).default(["credential_ref"]),
  failClosedDiagnostic: NonEmptyStringSchema,
  revocationCheck: exports_external.boolean().default(true)
}).strict();
var ProviderOperationCardSchema = exports_external.object({
  operation: NonEmptyStringSchema,
  supportedModes: exports_external.array(ProviderModeSchema).min(1),
  sideEffectClass: ProviderSideEffectClassSchema,
  requiresApproval: exports_external.boolean().default(false),
  requiresIdempotencyKey: exports_external.boolean().default(false),
  requiresSandboxEvidence: exports_external.boolean().default(false),
  requiresRollbackOrRevocation: exports_external.boolean().default(false),
  rollbackOrRevocation: NonEmptyStringSchema.optional(),
  noSideEffectSmoke: NonEmptyStringSchema.optional(),
  reconciliation: NonEmptyStringSchema.optional()
}).strict().superRefine((value, ctx) => {
  if (value.supportedModes.includes("live_mutating")) {
    if (value.sideEffectClass === "none" || value.sideEffectClass === "read_only") {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "live_mutating operations must declare a side-effecting class",
        path: ["sideEffectClass"]
      });
    }
    if (!value.requiresApproval) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "live_mutating operations require approval",
        path: ["requiresApproval"]
      });
    }
    if (!value.requiresIdempotencyKey) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "live_mutating operations require idempotency keys",
        path: ["requiresIdempotencyKey"]
      });
    }
    if (!value.requiresSandboxEvidence) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "live_mutating operations require sandbox evidence before live proof",
        path: ["requiresSandboxEvidence"]
      });
    }
    if (!value.requiresRollbackOrRevocation || !value.rollbackOrRevocation) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "live_mutating operations require rollback or revocation instructions",
        path: ["rollbackOrRevocation"]
      });
    }
    if (!value.reconciliation) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "live_mutating operations require reconciliation behavior",
        path: ["reconciliation"]
      });
    }
  }
});
var ProviderCapabilityCardSchema = exports_external.object({
  providerId: NonEmptyStringSchema,
  appId: NonEmptyStringSchema,
  adapterId: NonEmptyStringSchema,
  ownerPackage: NonEmptyStringSchema,
  modes: exports_external.array(ProviderModeSchema).min(1),
  defaultMode: ProviderModeSchema,
  credentialRequirements: exports_external.array(CredentialRequirementSchema).default([]),
  operations: exports_external.array(ProviderOperationCardSchema).min(1),
  rateLimitPosture: NonEmptyStringSchema,
  costPosture: NonEmptyStringSchema.optional(),
  auditEvents: exports_external.array(NonEmptyStringSchema).default([]),
  redactionRules: exports_external.array(NonEmptyStringSchema).default([]),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([])
}).strict().superRefine((value, ctx) => {
  if (!value.modes.includes(value.defaultMode)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "defaultMode must be one of modes",
      path: ["defaultMode"]
    });
  }
  const operationModes = new Set(value.operations.flatMap((operation) => operation.supportedModes));
  for (const mode of operationModes) {
    if (!value.modes.includes(mode)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `operation mode ${mode} is not declared in provider modes`,
        path: ["operations"]
      });
    }
  }
  if (operationModes.has("live_mutating")) {
    const liveCredential = value.credentialRequirements.some((credential) => credential.requiredForModes.includes("live_mutating"));
    if (!liveCredential) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "live_mutating providers require at least one live credential reference requirement",
        path: ["credentialRequirements"]
      });
    }
    if (value.auditEvents.length === 0) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "live_mutating providers require audit events",
        path: ["auditEvents"]
      });
    }
  }
});
var ProviderLiveModeTargetSchema = exports_external.object({
  appId: NonEmptyStringSchema,
  repo: NonEmptyStringSchema,
  priority: exports_external.enum(["p0", "p1", "p2"]).default("p1"),
  requiredEvidence: exports_external.array(NonEmptyStringSchema).min(1),
  firstOperations: exports_external.array(NonEmptyStringSchema).min(1),
  blockedUntil: exports_external.array(NonEmptyStringSchema).default([])
}).strict();
var ProviderLiveModeStandardSchema = contractBaseSchema(SCHEMA_IDS.providerLiveModeStandard).extend({
  name: NonEmptyStringSchema,
  version: NonEmptyStringSchema,
  modes: exports_external.array(ProviderModeSchema).refine((modes) => ["mock", "fixture", "sandbox", "read_only_live", "live_mutating"].every((mode) => modes.includes(mode)), "provider live-mode standard must include every canonical provider mode"),
  requiredCapabilityFields: exports_external.array(NonEmptyStringSchema).min(1),
  liveMutationGate: exports_external.object({
    requiredMode: exports_external.literal("live_mutating"),
    requiredChecks: exports_external.array(NonEmptyStringSchema).min(1),
    forbiddenBypassSignals: exports_external.array(NonEmptyStringSchema).min(1),
    disabledLiveSmoke: NonEmptyStringSchema
  }).strict(),
  noSideEffectSmoke: exports_external.object({
    requiredForModes: exports_external.array(ProviderModeSchema).min(1),
    commandEvidence: exports_external.array(NonEmptyStringSchema).min(1),
    secretOutputScan: exports_external.boolean().default(true)
  }).strict(),
  credentialPolicy: exports_external.object({
    acceptedInputs: exports_external.array(exports_external.enum(["credential_ref", "lease_ref"])).min(1),
    rawSecretInputsAllowed: exports_external.literal(false),
    missingCredentialBehavior: exports_external.literal("fail_closed"),
    revocationCheckRequired: exports_external.boolean().default(true)
  }).strict(),
  operationCards: exports_external.array(ProviderCapabilityCardSchema).min(1),
  firstAdoptionTargets: exports_external.array(ProviderLiveModeTargetSchema).min(1),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([])
}).strict().superRefine((value, ctx) => {
  const firstTargetApps = new Set(value.firstAdoptionTargets.map((target) => target.appId));
  const operationApps = new Set(value.operationCards.map((card) => card.appId));
  for (const appId of firstTargetApps) {
    if (!operationApps.has(appId)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `first adoption target ${appId} requires a provider capability card`,
        path: ["firstAdoptionTargets"]
      });
    }
  }
});
var ContextPackItemSchema = exports_external.object({
  id: exports_external.string().min(1),
  title: exports_external.string().min(1).optional(),
  summary: exports_external.string().min(1),
  text: exports_external.string().optional(),
  tokens: exports_external.number().int().nonnegative().optional(),
  source: EvidencePointerSchema,
  resourceRefs: exports_external.array(ResourcePointerSchema).default([])
}).strict();
var ContextPackSchema = contractBaseSchema(SCHEMA_IDS.contextPack).extend({
  objective: exports_external.string().min(1),
  budget: exports_external.object({
    maxTokens: exports_external.number().int().positive().optional(),
    maxBytes: exports_external.number().int().positive().optional()
  }).strict().optional(),
  items: exports_external.array(ContextPackItemSchema).default([]),
  citations: exports_external.array(EvidencePointerSchema).default([]),
  freshness: exports_external.enum(["fresh", "stale", "unknown"]).default("unknown"),
  permissions: exports_external.array(exports_external.string().min(1)).default([]),
  redactions: exports_external.array(exports_external.string().min(1)).default([]),
  conflicts: exports_external.array(exports_external.string().min(1)).default([]),
  uncertainty: exports_external.string().min(1).optional()
}).strict();
var RelativeProjectPathSchema = NonEmptyStringSchema.refine((value) => !value.startsWith("/") && !value.includes("\\") && !value.split("/").includes(".."), "Project paths must be relative and cannot contain parent-directory segments");
var ProjectSlugSchema = exports_external.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Project slugs must be lowercase dashed identifiers");
var ProjectClassificationSchema = exports_external.enum(["public", "internal", "private", "sensitive"]);
var ProjectStatusSchema = exports_external.enum(["draft", "active", "paused", "archived"]);
var ProjectIntegrationKindSchema = exports_external.enum([
  "todos",
  "files",
  "mailery",
  "conversations",
  "knowledge",
  "mementos",
  "reports",
  "actions",
  "render",
  "contracts",
  "custom"
]);
var IntegrationRefSchema = contractBaseSchema(SCHEMA_IDS.integrationRef).extend({
  kind: ProjectIntegrationKindSchema,
  name: exports_external.string().min(1),
  projectId: ProjectSlugSchema.optional(),
  sourcePackage: NonEmptyStringSchema.optional(),
  externalId: NonEmptyStringSchema.optional(),
  uri: UriSchema.optional(),
  enabled: exports_external.boolean().default(true),
  readOnly: exports_external.boolean().default(true),
  capabilities: exports_external.array(exports_external.string().min(1)).default([]),
  freshness: exports_external.enum(["fresh", "stale", "unknown"]).default("unknown"),
  resourceRef: ResourcePointerSchema.optional(),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([]),
  config: MetadataSchema.optional()
}).strict().superRefine((value, ctx) => {
  if (!value.uri && !(value.sourcePackage && value.externalId) && !value.resourceRef) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Integration refs require uri, resourceRef, or both sourcePackage and externalId",
      path: ["uri"]
    });
  }
});
var ProjectResourceAuthoritySchema = exports_external.enum([
  "todos",
  "conversations",
  "knowledge",
  "mementos",
  "orgs",
  "contacts"
]);
var ProjectResourceTargetKindSchema = exports_external.enum([
  "contact",
  "org",
  "project",
  "task",
  "task_list",
  "plan",
  "channel",
  "collection",
  "item"
]);
var ProjectResourceLinkScopeSchema = exports_external.enum(["resource", "collection"]);
var ProjectResourceExternalUuidValueSchema = exports_external.string().trim().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/, "Project resource external UUIDs must be complete RFC 4122 UUIDs").transform((value) => value.toLowerCase());
var ProjectResourceCanonicalUriValueSchema = exports_external.string().trim().min(1).transform((value, ctx) => {
  if (/^urn:[a-z0-9][a-z0-9-]{0,31}:[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+$/.test(value)) {
    return value;
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Project resource canonical URIs must use canonical HTTPS or URN syntax"
    });
    return exports_external.NEVER;
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Project resource canonical HTTPS URIs must not contain credentials"
    });
    return exports_external.NEVER;
  }
  if (url.search || url.hash) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Project resource canonical HTTPS URIs must not contain query or fragment components"
    });
    return exports_external.NEVER;
  }
  return url.toString();
});
var ProjectResourceLinkLabelsSchema = exports_external.object({
  name: NonEmptyStringSchema.optional(),
  channel_name: NonEmptyStringSchema.optional(),
  path: NonEmptyStringSchema.optional(),
  tags: exports_external.array(exports_external.string()).transform((tags) => [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].sort()).optional()
}).strict();
var ProjectResourceExternalUuidLocatorSchema = exports_external.object({
  kind: exports_external.literal("external_uuid"),
  value: ProjectResourceExternalUuidValueSchema
}).strict();
var ProjectResourceCanonicalUriLocatorSchema = exports_external.object({
  kind: exports_external.literal("canonical_uri"),
  value: ProjectResourceCanonicalUriValueSchema
}).strict();
var ProjectResourceConversationsChannelLocatorSchema = exports_external.object({
  kind: exports_external.literal("conversations_channel_id"),
  value: exports_external.string().regex(/^chn_[0-9a-f]{32}$/, "Conversations channel locators must match chn_<32 lowercase hex>")
}).strict();
var ProjectResourcePortableLocatorSchema = exports_external.discriminatedUnion("kind", [
  ProjectResourceExternalUuidLocatorSchema,
  ProjectResourceCanonicalUriLocatorSchema
]);
var ProjectResourceLinkLocatorSchema = exports_external.discriminatedUnion("kind", [
  ProjectResourceExternalUuidLocatorSchema,
  ProjectResourceCanonicalUriLocatorSchema,
  ProjectResourceConversationsChannelLocatorSchema
]);
var ProjectResourceLinkCommonShape = {
  service_instance: ProjectResourceCanonicalUriValueSchema,
  scope: ProjectResourceLinkScopeSchema,
  labels: ProjectResourceLinkLabelsSchema.optional()
};
var ProjectResourceTodosContainerLinkInputSchema = exports_external.object({
  authority: exports_external.literal("todos"),
  ...ProjectResourceLinkCommonShape,
  source_package: exports_external.literal("@hasna/todos"),
  target_kind: exports_external.enum(["project", "task_list", "plan"]),
  locator: ProjectResourcePortableLocatorSchema
}).strict();
var ProjectResourceTodosTaskLinkInputSchema = exports_external.object({
  authority: exports_external.literal("todos"),
  ...ProjectResourceLinkCommonShape,
  source_package: exports_external.literal("@hasna/todos"),
  target_kind: exports_external.literal("task"),
  locator: ProjectResourceExternalUuidLocatorSchema
}).strict();
var ProjectResourceConversationsProjectLinkInputSchema = exports_external.object({
  authority: exports_external.literal("conversations"),
  ...ProjectResourceLinkCommonShape,
  source_package: exports_external.literal("@hasna/conversations"),
  target_kind: exports_external.literal("project"),
  locator: ProjectResourcePortableLocatorSchema
}).strict();
var ProjectResourceConversationsChannelLinkInputSchema = exports_external.object({
  authority: exports_external.literal("conversations"),
  ...ProjectResourceLinkCommonShape,
  source_package: exports_external.literal("@hasna/conversations"),
  target_kind: exports_external.literal("channel"),
  locator: exports_external.discriminatedUnion("kind", [
    ProjectResourceExternalUuidLocatorSchema,
    ProjectResourceConversationsChannelLocatorSchema
  ])
}).strict();
var ProjectResourceKnowledgeLinkInputSchema = exports_external.object({
  authority: exports_external.literal("knowledge"),
  ...ProjectResourceLinkCommonShape,
  source_package: exports_external.literal("@hasna/knowledge"),
  target_kind: exports_external.enum(["collection", "item"]),
  locator: ProjectResourcePortableLocatorSchema
}).strict();
var ProjectResourceMementosLinkInputSchema = exports_external.object({
  authority: exports_external.literal("mementos"),
  ...ProjectResourceLinkCommonShape,
  source_package: exports_external.literal("@hasna/mementos"),
  target_kind: exports_external.enum(["project", "item"]),
  locator: ProjectResourcePortableLocatorSchema
}).strict();
var ProjectResourceOrgsLinkInputSchema = exports_external.object({
  authority: exports_external.literal("orgs"),
  ...ProjectResourceLinkCommonShape,
  source_package: exports_external.literal("@hasna/orgs"),
  target_kind: exports_external.enum(["org", "project"]),
  locator: ProjectResourcePortableLocatorSchema
}).strict();
var ProjectResourceContactsLinkInputSchema = exports_external.object({
  authority: exports_external.literal("contacts"),
  ...ProjectResourceLinkCommonShape,
  source_package: exports_external.literal("@hasna/contacts"),
  target_kind: exports_external.literal("contact"),
  locator: ProjectResourceExternalUuidLocatorSchema
}).strict();
var ProjectResourceLinkInputBranches = [
  ProjectResourceTodosContainerLinkInputSchema,
  ProjectResourceTodosTaskLinkInputSchema,
  ProjectResourceConversationsProjectLinkInputSchema,
  ProjectResourceConversationsChannelLinkInputSchema,
  ProjectResourceKnowledgeLinkInputSchema,
  ProjectResourceMementosLinkInputSchema,
  ProjectResourceOrgsLinkInputSchema,
  ProjectResourceContactsLinkInputSchema
];
function validateProjectResourceLinkSemantics(value, ctx) {
  const expectedUrnPrefix = `urn:hasna:${value.authority}:`;
  if (typeof value.service_instance === "string" && value.service_instance.startsWith("urn:") && !value.service_instance.startsWith(expectedUrnPrefix)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: `Project resource service_instance URNs for ${value.authority} must start with ${expectedUrnPrefix}`,
      path: ["service_instance"]
    });
  }
  if (value.locator.kind === "canonical_uri" && typeof value.locator.value === "string" && value.locator.value.startsWith("urn:") && !value.locator.value.startsWith(expectedUrnPrefix)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: `Project resource locator URNs for ${value.authority} must start with ${expectedUrnPrefix}`,
      path: ["locator", "value"]
    });
  }
  if (value.authority === "conversations" && value.target_kind === "channel" && !value.labels?.channel_name) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Conversations channel links require labels.channel_name",
      path: ["labels", "channel_name"]
    });
  }
}
var ProjectResourceLinkInputSchema = exports_external.union(ProjectResourceLinkInputBranches).superRefine(validateProjectResourceLinkSemantics);
var ProjectResourceLinkPersistedShape = {
  id: NonEmptyStringSchema,
  project_id: NonEmptyStringSchema,
  labels: ProjectResourceLinkLabelsSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema
};
var ProjectResourceLinkSchema = exports_external.union([
  ProjectResourceTodosContainerLinkInputSchema.extend(ProjectResourceLinkPersistedShape),
  ProjectResourceTodosTaskLinkInputSchema.extend(ProjectResourceLinkPersistedShape),
  ProjectResourceConversationsProjectLinkInputSchema.extend(ProjectResourceLinkPersistedShape),
  ProjectResourceConversationsChannelLinkInputSchema.extend(ProjectResourceLinkPersistedShape),
  ProjectResourceKnowledgeLinkInputSchema.extend(ProjectResourceLinkPersistedShape),
  ProjectResourceMementosLinkInputSchema.extend(ProjectResourceLinkPersistedShape),
  ProjectResourceOrgsLinkInputSchema.extend(ProjectResourceLinkPersistedShape),
  ProjectResourceContactsLinkInputSchema.extend(ProjectResourceLinkPersistedShape)
]).superRefine(validateProjectResourceLinkSemantics);
var ProjectResourceLinkCollectionV1Schema = exports_external.object({
  schema: exports_external.literal(SCHEMA_IDS.projectResourceLinkCollectionV1),
  project_id: NonEmptyStringSchema,
  current_revision: NonEmptyStringSchema,
  links: exports_external.array(ProjectResourceLinkSchema),
  link_count: exports_external.number().int().nonnegative(),
  max_items: exports_external.number().int().positive(),
  collection_digest: Sha256DigestSchema,
  complete: exports_external.boolean(),
  truncated: exports_external.boolean()
}).strict().superRefine((value, ctx) => {
  if (value.link_count !== value.links.length) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Project resource link_count must equal links.length",
      path: ["link_count"]
    });
  }
  if (value.link_count > value.max_items) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Project resource link_count must not exceed max_items",
      path: ["link_count"]
    });
  }
  if (value.complete && value.truncated) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "A complete project resource link collection cannot be truncated",
      path: ["truncated"]
    });
  }
  const linkIds = new Set;
  const identities = new Set;
  for (const [index, link] of value.links.entries()) {
    if (link.project_id !== value.project_id) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Every project resource link must belong to the collection project_id",
        path: ["links", index, "project_id"]
      });
    }
    if (linkIds.has(link.id)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Project resource link IDs must be unique within a collection",
        path: ["links", index, "id"]
      });
    }
    linkIds.add(link.id);
    const identity = JSON.stringify([
      link.authority,
      link.service_instance,
      link.source_package,
      link.target_kind,
      link.locator.kind,
      link.locator.value
    ]);
    if (identities.has(identity)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Project resource link identities must be unique within a collection",
        path: ["links", index]
      });
    }
    identities.add(identity);
  }
});
var ProjectLayoutSchema = exports_external.object({
  schemaRoot: RelativeProjectPathSchema,
  dashboardManifest: RelativeProjectPathSchema,
  snapshotsDir: RelativeProjectPathSchema,
  documentsDir: RelativeProjectPathSchema.default("documents"),
  reportsDir: RelativeProjectPathSchema.default("reports"),
  evidenceDir: RelativeProjectPathSchema,
  privateDir: RelativeProjectPathSchema
}).strict();
var ProjectManifestSchema = contractBaseSchema(SCHEMA_IDS.projectManifest).extend({
  projectId: ProjectSlugSchema,
  slug: ProjectSlugSchema,
  name: exports_external.string().min(1),
  summary: exports_external.string().min(1).optional(),
  status: ProjectStatusSchema.default("active"),
  classification: ProjectClassificationSchema.default("private"),
  owner: ActorPointerSchema.optional(),
  layout: ProjectLayoutSchema,
  integrations: exports_external.array(IntegrationRefSchema).default([]),
  renderManifests: exports_external.array(ResourcePointerSchema).default([]),
  resourceRefs: exports_external.array(ResourcePointerSchema).default([]),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([]),
  tags: TagsSchema
}).strict().superRefine((value, ctx) => {
  const integrationIds = new Set;
  const renderManifestIds = new Set;
  if (value.projectId !== value.slug) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "projectId and slug must match for canonical project manifests",
      path: ["slug"]
    });
  }
  for (const [index, integration] of value.integrations.entries()) {
    if (integrationIds.has(integration.id)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Project manifest integration ids must be unique",
        path: ["integrations", index, "id"]
      });
    }
    integrationIds.add(integration.id);
    if (integration.projectId && integration.projectId !== value.projectId) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Integration projectId must match the manifest projectId",
        path: ["integrations", index, "projectId"]
      });
    }
  }
  for (const [index, renderManifest] of value.renderManifests.entries()) {
    if (renderManifest.kind !== "render") {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Project renderManifests must use resource kind render",
        path: ["renderManifests", index, "kind"]
      });
    }
    if (renderManifestIds.has(renderManifest.id)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Project renderManifest refs must be unique",
        path: ["renderManifests", index, "id"]
      });
    }
    renderManifestIds.add(renderManifest.id);
  }
});
var RenderImportKindSchema = exports_external.enum(["local", "package", "provider", "url"]);
var RenderImportSchema = exports_external.object({
  id: exports_external.string().min(1),
  kind: RenderImportKindSchema,
  specifier: exports_external.string().min(1),
  path: RelativeProjectPathSchema.optional(),
  packageName: exports_external.string().min(1).optional(),
  uri: UriSchema.optional(),
  provider: ProjectIntegrationKindSchema.optional(),
  schemaId: SchemaIdSchema.optional(),
  integrity: HashStringSchema.optional(),
  resourceRef: ResourcePointerSchema.optional(),
  optional: exports_external.boolean().default(false)
}).strict().superRefine((value, ctx) => {
  if (value.kind === "local" && !value.path) {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Local render imports require path", path: ["path"] });
  }
  if (value.kind === "package" && !value.packageName) {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Package render imports require packageName", path: ["packageName"] });
  }
  if (value.kind === "provider" && !value.provider) {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Provider render imports require provider", path: ["provider"] });
  }
  if (value.kind === "url" && !value.uri) {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "URL render imports require uri", path: ["uri"] });
  }
});
var RenderViewKindSchema = exports_external.enum(["dashboard", "canvas", "panel", "report", "document", "custom"]);
var RenderViewSchema = exports_external.object({
  id: exports_external.string().min(1),
  title: exports_external.string().min(1),
  kind: RenderViewKindSchema,
  default: exports_external.boolean().default(false),
  entry: RelativeProjectPathSchema.optional(),
  imports: exports_external.array(RenderImportSchema).default([]),
  panelRefs: exports_external.array(ResourcePointerSchema).default([]),
  dataRefs: exports_external.array(ResourcePointerSchema).default([]),
  layout: MetadataSchema.optional()
}).strict();
var RenderManifestSchema = contractBaseSchema(SCHEMA_IDS.renderManifest).extend({
  projectId: ProjectSlugSchema,
  name: exports_external.string().min(1),
  version: exports_external.string().min(1),
  manifestPath: RelativeProjectPathSchema,
  renderer: exports_external.enum(["json_render", "react_flow", "markdown", "html", "custom"]).default("json_render"),
  views: exports_external.array(RenderViewSchema).min(1),
  imports: exports_external.array(RenderImportSchema).default([]),
  theme: MetadataSchema.optional(),
  compatibility: exports_external.object({
    minProjectsVersion: exports_external.string().min(1).optional(),
    minContractsVersion: exports_external.string().min(1).optional()
  }).strict().optional(),
  resourceRefs: exports_external.array(ResourcePointerSchema).default([]),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([])
}).strict().superRefine((value, ctx) => {
  const defaults = value.views.filter((view) => view.default);
  const viewIds = new Set;
  const importIds = new Set;
  if (defaults.length > 1) {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Render manifests can have at most one default view", path: ["views"] });
  }
  for (const [index, importRef] of value.imports.entries()) {
    if (importIds.has(importRef.id)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Render manifest import ids must be unique",
        path: ["imports", index, "id"]
      });
    }
    importIds.add(importRef.id);
  }
  for (const [viewIndex, view] of value.views.entries()) {
    if (viewIds.has(view.id)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Render manifest view ids must be unique",
        path: ["views", viewIndex, "id"]
      });
    }
    viewIds.add(view.id);
    const viewImportIds = new Set;
    for (const [importIndex, importRef] of view.imports.entries()) {
      if (viewImportIds.has(importRef.id)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Render view import ids must be unique",
          path: ["views", viewIndex, "imports", importIndex, "id"]
        });
      }
      viewImportIds.add(importRef.id);
    }
    for (const [panelIndex, panelRef] of view.panelRefs.entries()) {
      if (panelRef.kind !== "panel") {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Render view panelRefs must use resource kind panel",
          path: ["views", viewIndex, "panelRefs", panelIndex, "kind"]
        });
      }
    }
  }
});
var ProjectPanelStateSchema = exports_external.enum(["ready", "empty", "loading", "error", "auth_required", "unavailable", "stale"]);
var ProjectPanelKindSchema = exports_external.enum([
  "overview",
  "tasks",
  "files",
  "mailery",
  "conversations",
  "knowledge",
  "mementos",
  "reports",
  "actions",
  "timeline",
  "risks",
  "documents",
  "custom"
]);
var ProjectPanelMetricSchema = exports_external.object({
  id: exports_external.string().min(1),
  label: exports_external.string().min(1),
  value: exports_external.union([exports_external.string(), exports_external.number(), exports_external.boolean()]),
  unit: exports_external.string().min(1).optional(),
  status: exports_external.enum(["good", "warning", "critical", "unknown"]).default("unknown"),
  resourceRefs: exports_external.array(ResourcePointerSchema).default([])
}).strict();
var ProjectPanelItemSchema = exports_external.object({
  id: exports_external.string().min(1),
  title: exports_external.string().min(1),
  summary: exports_external.string().min(1).optional(),
  status: exports_external.string().min(1).optional(),
  priority: exports_external.enum(["low", "medium", "high", "critical", "unknown"]).default("unknown"),
  timestamp: TimestampSchema.optional(),
  resourceRefs: exports_external.array(ResourcePointerSchema).default([]),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([]),
  metadata: MetadataSchema.optional()
}).strict();
var ProjectRenderFragmentSchema = exports_external.object({
  renderer: exports_external.enum(["json_render", "react_flow", "markdown", "html", "custom"]).default("json_render"),
  title: exports_external.string().min(1).optional(),
  entry: RelativeProjectPathSchema.optional(),
  imports: exports_external.array(RenderImportSchema).default([]),
  spec: MetadataSchema.default({})
}).strict();
var ProjectPanelSchema = contractBaseSchema(SCHEMA_IDS.projectPanel).extend({
  projectId: ProjectSlugSchema,
  provider: exports_external.object({
    kind: ProjectIntegrationKindSchema,
    id: exports_external.string().min(1),
    name: exports_external.string().min(1).optional(),
    sourcePackage: NonEmptyStringSchema.optional(),
    externalId: NonEmptyStringSchema.optional()
  }).strict(),
  kind: ProjectPanelKindSchema,
  title: exports_external.string().min(1),
  summary: exports_external.string().min(1).optional(),
  state: ProjectPanelStateSchema.default("ready"),
  stateReason: exports_external.string().min(1).optional(),
  generatedAt: TimestampSchema,
  freshness: exports_external.enum(["fresh", "stale", "unknown"]).default("unknown"),
  metrics: exports_external.array(ProjectPanelMetricSchema).default([]),
  items: exports_external.array(ProjectPanelItemSchema).default([]),
  actions: exports_external.array(ResourcePointerSchema).default([]),
  resourceRefs: exports_external.array(ResourcePointerSchema).default([]),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([]),
  renderFragment: ProjectRenderFragmentSchema.optional(),
  warnings: exports_external.array(exports_external.string().min(1)).default([])
}).strict().superRefine((value, ctx) => {
  const reasonStates = new Set(["error", "auth_required", "unavailable", "stale"]);
  const metricIds = new Set;
  const itemIds = new Set;
  if (reasonStates.has(value.state) && !value.stateReason) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Non-ready provider states require stateReason",
      path: ["stateReason"]
    });
  }
  if (value.state === "ready" && value.metrics.length === 0 && value.items.length === 0 && !value.renderFragment) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Ready panels require metrics, items, or a renderFragment; use state=empty for empty panels",
      path: ["state"]
    });
  }
  for (const [index, metric] of value.metrics.entries()) {
    if (metricIds.has(metric.id)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Project panel metric ids must be unique",
        path: ["metrics", index, "id"]
      });
    }
    metricIds.add(metric.id);
  }
  for (const [index, item] of value.items.entries()) {
    if (itemIds.has(item.id)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Project panel item ids must be unique",
        path: ["items", index, "id"]
      });
    }
    itemIds.add(item.id);
  }
  for (const [index, action] of value.actions.entries()) {
    if (action.kind !== "action") {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Project panel actions must use resource kind action",
        path: ["actions", index, "kind"]
      });
    }
  }
});
var ProjectSnapshotSchema = contractBaseSchema(SCHEMA_IDS.projectSnapshot).extend({
  projectId: ProjectSlugSchema,
  generatedAt: TimestampSchema,
  status: ContractStatusSchema.default("unknown"),
  manifestRef: ResourcePointerSchema,
  renderManifestRef: ResourcePointerSchema.optional(),
  panels: exports_external.array(ProjectPanelSchema).default([]),
  contextPacks: exports_external.array(ContextPackSchema).default([]),
  proofBundleRefs: exports_external.array(ResourcePointerSchema).default([]),
  resourceRefs: exports_external.array(ResourcePointerSchema).default([]),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([]),
  warnings: exports_external.array(exports_external.string().min(1)).default([]),
  freshness: exports_external.enum(["fresh", "stale", "unknown"]).default("unknown")
}).strict().superRefine((value, ctx) => {
  const panelIds = new Set;
  const contextPackIds = new Set;
  if (value.manifestRef.kind !== "project") {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Project snapshot manifestRef must use resource kind project",
      path: ["manifestRef", "kind"]
    });
  }
  if (value.renderManifestRef && value.renderManifestRef.kind !== "render") {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Project snapshot renderManifestRef must use resource kind render",
      path: ["renderManifestRef", "kind"]
    });
  }
  for (const [index, proofBundleRef] of value.proofBundleRefs.entries()) {
    if (proofBundleRef.kind !== "proof_bundle") {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Project snapshot proofBundleRefs must use resource kind proof_bundle",
        path: ["proofBundleRefs", index, "kind"]
      });
    }
  }
  for (const [index, panel] of value.panels.entries()) {
    if (panel.projectId !== value.projectId) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Panel projectId must match snapshot projectId",
        path: ["panels", index, "projectId"]
      });
    }
    if (panelIds.has(panel.id)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Project snapshot panel ids must be unique",
        path: ["panels", index, "id"]
      });
    }
    panelIds.add(panel.id);
  }
  for (const [index, contextPack] of value.contextPacks.entries()) {
    if (contextPackIds.has(contextPack.id)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Project snapshot context pack ids must be unique",
        path: ["contextPacks", index, "id"]
      });
    }
    contextPackIds.add(contextPack.id);
  }
});
var ValidationCheckSchema = exports_external.object({
  id: exports_external.string().min(1),
  kind: exports_external.enum(["command", "test", "typecheck", "lint", "eval", "security", "review", "deploy", "smoke", "manual", "other"]),
  required: exports_external.boolean().default(true),
  command: exports_external.string().min(1).optional(),
  expected: exports_external.string().min(1).optional(),
  timeoutMs: exports_external.number().int().positive().optional(),
  resourceRefs: exports_external.array(ResourcePointerSchema).default([])
}).strict().superRefine((value, ctx) => {
  const actionableKinds = new Set(["command", "test", "typecheck", "lint", "smoke", "eval"]);
  if (actionableKinds.has(value.kind) && !value.command && !value.expected) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Actionable validation checks require command or expected",
      path: ["command"]
    });
  }
});
var ValidationPlanSchema = contractBaseSchema(SCHEMA_IDS.validationPlan).extend({
  objective: exports_external.string().min(1),
  subject: ResourcePointerSchema.optional(),
  checks: exports_external.array(ValidationCheckSchema).min(1),
  verifier: ActorPointerSchema.optional(),
  requiredEvidenceKinds: exports_external.array(EvidenceKindSchema).default([])
}).strict();
var ScaffoldTypeSchema = exports_external.enum([
  "open_source",
  "internal_app",
  "platform",
  "app",
  "agent",
  "content",
  "overlay",
  "other"
]);
var ScaffoldStatusSchema = exports_external.enum(["draft", "active", "deprecated", "archived"]);
var ScaffoldCapabilitySchema = exports_external.enum([
  "cli",
  "mcp",
  "library",
  "sdk",
  "rest_api",
  "dashboard",
  "database",
  "auth",
  "billing",
  "worker",
  "daemon",
  "native",
  "browser_extension",
  "ai_provider",
  "media_pipeline",
  "data_pipeline",
  "tests",
  "ci",
  "deployment",
  "docs",
  "other"
]);
var ScaffoldEnvVarSchema = exports_external.object({
  key: exports_external.string().regex(/^[A-Z][A-Z0-9_]*$/),
  description: exports_external.string().min(1),
  required: exports_external.boolean().default(false),
  ["secret"]: exports_external.boolean().default(false),
  group: exports_external.string().min(1).optional(),
  default: exports_external.string().optional()
}).strict().superRefine((value, ctx) => {
  if (value.secret && value.default !== undefined) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Secret scaffold env vars cannot include defaults",
      path: ["default"]
    });
  }
});
var ScaffoldScriptSchema = exports_external.object({
  name: exports_external.string().min(1),
  command: exports_external.string().min(1),
  description: exports_external.string().min(1).optional(),
  required: exports_external.boolean().default(false)
}).strict();
var ScaffoldOutputShapeSchema = exports_external.object({
  packageManager: exports_external.enum(["bun", "npm", "pnpm", "yarn", "cargo", "pip", "other"]).optional(),
  languages: exports_external.array(exports_external.string().min(1)).default([]),
  requiredFiles: exports_external.array(exports_external.string().min(1)).default([]),
  requiredDirectories: exports_external.array(exports_external.string().min(1)).default([]),
  optionalDirectories: exports_external.array(exports_external.string().min(1)).default([])
}).strict();
var ScaffoldManifestSchema = contractBaseSchema(SCHEMA_IDS.scaffoldManifest).extend({
  name: exports_external.string().min(1),
  version: exports_external.string().min(1),
  summary: exports_external.string().min(1),
  type: ScaffoldTypeSchema,
  status: ScaffoldStatusSchema.default("draft"),
  capabilities: exports_external.array(ScaffoldCapabilitySchema).default([]),
  techStack: exports_external.array(exports_external.string().min(1)).default([]),
  tags: TagsSchema,
  source: ResourcePointerSchema.optional(),
  output: ScaffoldOutputShapeSchema,
  env: exports_external.array(ScaffoldEnvVarSchema).default([]),
  scripts: exports_external.array(ScaffoldScriptSchema).default([]),
  validationChecks: exports_external.array(ValidationCheckSchema).default([]),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([])
}).strict().superRefine((value, ctx) => {
  if (value.source?.uri?.startsWith("file://")) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Public scaffold manifest source refs cannot use local file:// URIs",
      path: ["source", "uri"]
    });
  }
  if (value.status === "active" && value.validationChecks.length === 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Active scaffold manifests require validation checks",
      path: ["validationChecks"]
    });
  }
  if (value.status === "active" && value.output.requiredFiles.length === 0 && value.output.requiredDirectories.length === 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Active scaffold manifests require at least one required file or directory",
      path: ["output"]
    });
  }
});
var ScaffoldInstallStatusSchema = exports_external.enum(["installed", "failed", "cancelled", "partial", "unknown"]);
var ScaffoldInstallRecordSchema = contractBaseSchema(SCHEMA_IDS.scaffoldInstallRecord).extend({
  scaffoldId: exports_external.string().min(1),
  scaffoldVersion: exports_external.string().min(1).optional(),
  manifestRef: ResourcePointerSchema.optional(),
  target: ResourcePointerSchema,
  status: ScaffoldInstallStatusSchema,
  installedAt: TimestampSchema.optional(),
  installer: ActorPointerSchema.optional(),
  packageManager: exports_external.enum(["bun", "npm", "pnpm", "yarn", "cargo", "pip", "other"]).optional(),
  options: MetadataSchema.optional(),
  generatedFiles: exports_external.array(ResourcePointerSchema).default([]),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([]),
  proofBundleRefs: exports_external.array(ResourcePointerSchema).default([])
}).strict().superRefine((value, ctx) => {
  if (value.status === "installed" && !value.installedAt) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Installed scaffold records require installedAt",
      path: ["installedAt"]
    });
  }
  if (value.status === "installed" && value.generatedFiles.length === 0 && value.evidenceRefs.length === 0 && value.proofBundleRefs.length === 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Installed scaffold records require generated files, evidence, or proof bundle refs",
      path: ["generatedFiles"]
    });
  }
  if ((value.status === "failed" || value.status === "partial") && value.evidenceRefs.length === 0 && value.proofBundleRefs.length === 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Failed or partial scaffold records require evidence or proof bundle refs",
      path: ["evidenceRefs"]
    });
  }
});
var AppIdSchema = exports_external.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "App ids must be lowercase dashed identifiers");
var NpmPackageNameSchema = exports_external.string().regex(/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/, "Must be a valid npm package name");
var SemverSchema = exports_external.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/, "Must be a semver version");
var GitShaSchema = exports_external.string().regex(/^[0-9a-f]{7,40}$/, "Must be a lowercase git sha (7-40 hex chars)");
var GithubUrlSchema = NonEmptyStringSchema.refine((value) => value.startsWith("https://github.com/") || value.startsWith("git+https://github.com/"), "GitHub URLs must start with https://github.com/ or git+https://github.com/");
var AppLifecycleSchema = exports_external.enum(["active", "stub", "deprecated", "archived"]);
var ReleaseChannelSchema = exports_external.enum(["stable", "beta", "canary", "internal"]);
var AppMcpSurfaceSchema = exports_external.object({
  transport: exports_external.enum(["http", "stdio"]).default("http"),
  bin: exports_external.string().min(1).optional(),
  url: UriSchema.optional()
}).strict();
var AppHttpSurfaceSchema = exports_external.object({
  healthPath: exports_external.string().min(1).default("/health"),
  port: exports_external.number().int().positive().optional(),
  baseUrl: UriSchema.optional()
}).strict();
var AppSurfacesSchema = exports_external.object({
  bins: exports_external.array(exports_external.string().min(1)).default([]),
  mcp: AppMcpSurfaceSchema.optional(),
  http: AppHttpSurfaceSchema.optional()
}).strict();
var AppSchema = contractBaseSchema(SCHEMA_IDS.app).extend({
  appId: AppIdSchema,
  npmName: NpmPackageNameSchema,
  repoFolder: AppIdSchema,
  githubUrl: GithubUrlSchema,
  projectSlug: ProjectSlugSchema,
  surfaces: AppSurfacesSchema.default({}),
  lifecycle: AppLifecycleSchema,
  releaseChannel: ReleaseChannelSchema.default("stable"),
  summary: exports_external.string().min(1).optional(),
  tags: TagsSchema
}).strict().superRefine((value, ctx) => {
  const seenBins = new Set;
  for (const [index, bin] of value.surfaces.bins.entries()) {
    if (seenBins.has(bin)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "App surface bins must be unique",
        path: ["surfaces", "bins", index]
      });
    }
    seenBins.add(bin);
  }
});
var PublishPathSchema = exports_external.enum(["skill", "ci", "backfilled"]);
var ReleaseSchema = contractBaseSchema(SCHEMA_IDS.release).extend({
  appId: AppIdSchema,
  package: NpmPackageNameSchema,
  version: SemverSchema,
  gitSha: GitShaSchema,
  publishedAt: TimestampSchema,
  publishPath: PublishPathSchema,
  changelogRef: ResourcePointerSchema.optional(),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([])
}).strict().superRefine((value, ctx) => {
  if (value.publishPath !== "backfilled" && value.evidenceRefs.length === 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "skill and ci releases require publish evidence; only backfilled releases may omit it",
      path: ["evidenceRefs"]
    });
  }
});
var RolloutActionSchema = exports_external.enum(["install", "update", "rollback", "freeze-blocked"]);
var RolloutVerificationSchema = exports_external.object({
  cliVersion: exports_external.string().min(1).optional(),
  mcpHealth: exports_external.enum(["ok", "degraded", "unavailable", "not_checked"]).optional()
}).strict().superRefine((value, ctx) => {
  if (!value.cliVersion && value.mcpHealth === undefined) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Rollout verification requires at least one concrete verifier field"
    });
  }
});
var RolloutRecordSchema = contractBaseSchema(SCHEMA_IDS.rolloutRecord).extend({
  appId: AppIdSchema,
  package: NpmPackageNameSchema,
  version: SemverSchema,
  machine: NonEmptyStringSchema,
  action: RolloutActionSchema,
  result: ContractStatusSchema,
  verifiedBy: RolloutVerificationSchema.optional(),
  at: TimestampSchema,
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([])
}).strict().superRefine((value, ctx) => {
  if (value.action === "freeze-blocked" && value.result !== "blocked" && value.result !== "skipped") {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "freeze-blocked rollout records must report result blocked or skipped",
      path: ["result"]
    });
  }
  const hasConcreteVerification = Boolean(value.verifiedBy?.cliVersion) || value.verifiedBy?.mcpHealth !== undefined && value.verifiedBy.mcpHealth !== "not_checked";
  const hasVerifierFields = value.verifiedBy ? Object.keys(value.verifiedBy).length > 0 : false;
  if ((value.action === "install" || value.action === "update") && value.result === "succeeded" && (!value.verifiedBy || hasVerifierFields && !hasConcreteVerification)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Succeeded install/update rollout records require concrete verification",
      path: ["verifiedBy"]
    });
  }
});
var AnnouncementChannelKindSchema = exports_external.enum([
  "email",
  "telegram",
  "slack",
  "discord",
  "x",
  "blog",
  "rss",
  "webhook",
  "github",
  "other"
]);
var AnnouncementDeliveryStatusSchema = exports_external.enum([
  "pending",
  "queued",
  "sent",
  "failed",
  "skipped",
  "suppressed"
]);
var AnnouncementChannelSchema = exports_external.object({
  channel: AnnouncementChannelKindSchema,
  status: AnnouncementDeliveryStatusSchema,
  deliveredAt: TimestampSchema.optional(),
  detail: exports_external.string().min(1).optional()
}).strict().superRefine((value, ctx) => {
  if (value.status === "sent" && !value.deliveredAt) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Sent announcement channels require deliveredAt",
      path: ["deliveredAt"]
    });
  }
  if (value.status === "failed" && !value.detail) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Failed announcement channels require detail",
      path: ["detail"]
    });
  }
});
var AnnouncementSchema = contractBaseSchema(SCHEMA_IDS.announcement).extend({
  campaignId: NonEmptyStringSchema,
  appId: AppIdSchema.optional(),
  releaseRef: ResourcePointerSchema.optional(),
  channels: exports_external.array(AnnouncementChannelSchema).min(1),
  audienceRef: ResourcePointerSchema,
  sentAt: TimestampSchema
}).strict().superRefine((value, ctx) => {
  if (value.releaseRef && value.releaseRef.kind !== "release") {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Announcement releaseRef must use resource kind release",
      path: ["releaseRef", "kind"]
    });
  }
  if (value.audienceRef.kind !== "audience") {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Announcement audienceRef must use resource kind audience",
      path: ["audienceRef", "kind"]
    });
  }
});
var AudiencePredicateKindSchema = exports_external.enum(["tag", "attribute", "group"]);
var AudiencePredicateOpSchema = exports_external.enum(["eq", "neq", "in", "not_in", "exists", "not_exists"]);
var AudiencePredicateValueSchema = exports_external.union([exports_external.string(), exports_external.number(), exports_external.boolean()]);
var AudiencePredicateSchema = exports_external.object({
  kind: AudiencePredicateKindSchema,
  key: exports_external.string().min(1).optional(),
  op: AudiencePredicateOpSchema.default("eq"),
  value: AudiencePredicateValueSchema.optional(),
  values: exports_external.array(AudiencePredicateValueSchema).default([])
}).strict().superRefine((value, ctx) => {
  if (value.kind === "attribute" && !value.key) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Attribute predicates require key",
      path: ["key"]
    });
  }
  if ((value.op === "eq" || value.op === "neq") && value.value === undefined) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "eq/neq predicates require value",
      path: ["value"]
    });
  }
  if ((value.op === "in" || value.op === "not_in") && value.values.length === 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "in/not_in predicates require values",
      path: ["values"]
    });
  }
});
var AudienceDefinitionSchema = exports_external.object({
  match: exports_external.enum(["all", "any"]).default("all"),
  predicates: exports_external.array(AudiencePredicateSchema).min(1)
}).strict();
var ConsentPolicySchema = exports_external.enum(["opt_in", "opt_out", "transactional", "none"]);
var AudienceSchema = contractBaseSchema(SCHEMA_IDS.audience).extend({
  audienceId: AppIdSchema,
  name: NonEmptyStringSchema,
  definition: AudienceDefinitionSchema,
  consentPolicy: ConsentPolicySchema,
  suppressionSyncedAt: OptionalTimestampSchema
}).strict();
var FORBIDDEN_SHARED_CLOUD_RUNTIMES = ["@hasna/cloud", "open-cloud"];
var AppCloudProviderSchema = exports_external.enum([
  "aws",
  "gcp",
  "azure",
  "cloudflare",
  "vercel",
  "neon",
  "supabase",
  "postgres",
  "s3",
  "rds",
  "other"
]);
var AppCloudResourceSchema = exports_external.object({
  id: exports_external.string().min(1),
  provider: AppCloudProviderSchema,
  kind: exports_external.enum([
    "database",
    "bucket",
    "queue",
    "secret",
    "function",
    "worker",
    "cache",
    "topic",
    "scheduler",
    "object_store",
    "other"
  ]),
  ownerPackage: exports_external.string().min(1),
  region: exports_external.string().min(1).optional(),
  accountId: exports_external.string().min(1).optional(),
  uri: UriSchema.optional(),
  machineScoped: exports_external.boolean().default(false)
}).strict();
var AppCloudManifestSchema = contractBaseSchema(SCHEMA_IDS.appCloudManifest).extend({
  packageName: exports_external.string().min(1),
  packageVersion: exports_external.string().min(1).optional(),
  appId: exports_external.string().min(1),
  repository: ResourcePointerSchema.optional(),
  cloudBoundary: exports_external.enum(["none", "app_owned", "external_service", "local_cache"]),
  cloudResources: exports_external.array(AppCloudResourceSchema).default([]),
  localCache: exports_external.object({
    path: exports_external.string().min(1).optional(),
    pullMode: exports_external.enum(["manual", "daemon", "ci", "none"]).default("manual"),
    conflictPolicy: exports_external.enum(["cloud_wins", "local_wins", "merge", "manual_review"]).default("manual_review")
  }).strict().optional(),
  forbiddenSharedRuntimes: exports_external.array(exports_external.string().min(1)).default([...FORBIDDEN_SHARED_CLOUD_RUNTIMES]),
  dependencies: exports_external.array(exports_external.string().min(1)).default([]),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([])
}).strict().superRefine((value, ctx) => {
  const effectiveForbiddenRuntimes = new Set([...FORBIDDEN_SHARED_CLOUD_RUNTIMES, ...value.forbiddenSharedRuntimes]);
  if (effectiveForbiddenRuntimes.has(value.packageName)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "App-owned cloud manifests cannot be for a forbidden runtime",
      path: ["packageName"]
    });
  }
  for (const runtime of FORBIDDEN_SHARED_CLOUD_RUNTIMES) {
    if (!value.forbiddenSharedRuntimes.includes(runtime)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `forbiddenSharedRuntimes must include ${runtime}`,
        path: ["forbiddenSharedRuntimes"]
      });
    }
  }
  for (const runtime of effectiveForbiddenRuntimes) {
    if (value.dependencies.includes(runtime)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `App-owned cloud manifests cannot depend on ${runtime}`,
        path: ["dependencies"]
      });
    }
  }
  if (value.cloudBoundary === "local_cache") {
    if (!value.localCache) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "A local_cache boundary requires localCache settings",
        path: ["localCache"]
      });
    }
  }
  if (value.cloudBoundary === "external_service") {
    if (value.cloudResources.length > 0) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "An external_service boundary must not declare app-owned cloudResources",
        path: ["cloudResources"]
      });
    }
  }
  if ((value.cloudBoundary === "app_owned" || value.cloudBoundary === "local_cache") && value.cloudResources.length === 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "App-owned boundaries require explicit app-owned cloudResources",
      path: ["cloudResources"]
    });
  }
  if (value.cloudBoundary === "none" && value.cloudResources.length > 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "cloudBoundary none cannot declare cloudResources",
      path: ["cloudResources"]
    });
  }
  value.cloudResources.forEach((resource, index) => {
    if (resource.ownerPackage !== value.packageName) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Cloud resources must be owned by the app package that declares the manifest",
        path: ["cloudResources", index, "ownerPackage"]
      });
    }
  });
});
var NoCloudCheckKindSchema = exports_external.enum([
  "package_manifest",
  "lockfile",
  "source_import",
  "runtime_config",
  "packed_artifact",
  "published_metadata",
  "app_cloud_manifest",
  "remote_config",
  "boundary_doc",
  "other"
]);
var NoCloudFindingSeveritySchema = exports_external.enum(["low", "medium", "high", "critical"]);
var NoCloudFindingSchema = exports_external.object({
  id: exports_external.string().min(1),
  kind: NoCloudCheckKindSchema,
  severity: NoCloudFindingSeveritySchema,
  path: exports_external.string().min(1).optional(),
  packageName: exports_external.string().min(1).optional(),
  pattern: exports_external.string().min(1),
  message: exports_external.string().min(1),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([])
}).strict();
var NoCloudCheckResultSchema = exports_external.object({
  id: exports_external.string().min(1),
  kind: NoCloudCheckKindSchema,
  status: ContractStatusSchema,
  target: exports_external.string().min(1),
  command: exports_external.string().min(1).optional(),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([]),
  findings: exports_external.array(NoCloudFindingSchema).default([])
}).strict();
var NoCloudEvidencePackSchema = contractBaseSchema(SCHEMA_IDS.noCloudEvidencePack).extend({
  subject: ResourcePointerSchema,
  packageName: exports_external.string().min(1).optional(),
  packageVersion: exports_external.string().min(1).optional(),
  generatedBy: ActorPointerSchema.optional(),
  scanMode: exports_external.enum(["source_tree", "packed_artifact", "published_metadata", "runtime_config", "workspace", "ci"]),
  status: ContractStatusSchema,
  verdict: exports_external.enum(["passed", "failed", "warning", "not_run"]),
  appCloudManifest: AppCloudManifestSchema.optional(),
  checks: exports_external.array(NoCloudCheckResultSchema).min(1),
  findings: exports_external.array(NoCloudFindingSchema).default([]),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([])
}).strict().superRefine((value, ctx) => {
  const allFindings = [...value.findings, ...value.checks.flatMap((check2) => check2.findings)];
  const blockingFindings = allFindings.filter((finding) => finding.severity === "high" || finding.severity === "critical");
  if (value.verdict === "passed") {
    if (value.status !== "succeeded") {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Passed no-cloud evidence requires succeeded status", path: ["status"] });
    }
    if (blockingFindings.length > 0) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Passed no-cloud evidence cannot include high or critical findings", path: ["findings"] });
    }
    if (value.checks.some((check2) => check2.status !== "succeeded")) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Passed no-cloud evidence requires every check to be succeeded", path: ["checks"] });
    }
  }
  if (value.verdict === "failed" && allFindings.length === 0) {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Failed no-cloud evidence requires findings", path: ["findings"] });
  }
  if (value.status === "succeeded" && value.checks.some((check2) => check2.status === "failed")) {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Succeeded no-cloud evidence cannot contain failed checks", path: ["checks"] });
  }
  value.checks.forEach((check2, index) => {
    const checkBlockingFindings = check2.findings.filter((finding) => finding.severity === "high" || finding.severity === "critical");
    if (check2.status === "succeeded" && checkBlockingFindings.length > 0) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Succeeded no-cloud checks cannot contain high or critical findings",
        path: ["checks", index, "findings"]
      });
    }
  });
});
var ProofCheckResultSchema = exports_external.object({
  checkId: exports_external.string().min(1),
  status: ContractStatusSchema,
  summary: exports_external.string().min(1).optional(),
  startedAt: OptionalTimestampSchema,
  finishedAt: OptionalTimestampSchema,
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([])
}).strict();
var ProofBundleSchema = contractBaseSchema(SCHEMA_IDS.proofBundle).extend({
  subject: ResourcePointerSchema,
  validationPlanRef: ResourcePointerSchema.optional(),
  status: ContractStatusSchema,
  verdict: exports_external.enum(["passed", "failed", "inconclusive", "not_run"]).default("inconclusive"),
  checks: exports_external.array(ProofCheckResultSchema).default([]),
  verifier: ActorPointerSchema.optional(),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([]),
  residualRisks: exports_external.array(exports_external.string().min(1)).default([]),
  freshness: exports_external.enum(["fresh", "stale", "unknown"]).default("unknown")
}).strict().superRefine((value, ctx) => {
  if (value.verdict === "passed") {
    if (value.status !== "succeeded") {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Passed proof bundles must have status succeeded",
        path: ["status"]
      });
    }
    if (value.checks.length === 0) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Passed proof bundles require at least one check result",
        path: ["checks"]
      });
    }
    value.checks.forEach((check2, index) => {
      if (check2.status !== "succeeded") {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Passed proof bundles require all checks to have status succeeded",
          path: ["checks", index, "status"]
        });
      }
    });
    const hasEvidence = value.evidenceRefs.length > 0 || value.checks.some((check2) => check2.evidenceRefs.length > 0);
    if (!hasEvidence) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Passed proof bundles require evidence",
        path: ["evidenceRefs"]
      });
    }
    if (!value.verifier) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Passed proof bundles require a verifier",
        path: ["verifier"]
      });
    }
  }
  if (value.verdict === "not_run" && value.checks.length > 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Not-run proof bundles cannot include check results",
      path: ["checks"]
    });
  }
  if (value.verdict === "failed" && !value.checks.some((check2) => check2.status === "failed") && value.evidenceRefs.length === 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Failed proof bundles require a failed check or evidence",
      path: ["checks"]
    });
  }
});
var WorkRunSchema = contractBaseSchema(SCHEMA_IDS.workRun).extend({
  objective: exports_external.string().min(1),
  status: ContractStatusSchema,
  actor: ActorPointerSchema,
  traceId: exports_external.string().min(1).optional(),
  startedAt: OptionalTimestampSchema,
  finishedAt: OptionalTimestampSchema,
  constraints: exports_external.array(exports_external.string().min(1)).default([]),
  resourceRefs: exports_external.array(ResourcePointerSchema).default([]),
  decisions: exports_external.array(DecisionEnvelopeSchema).default([]),
  costEstimates: exports_external.array(CostEstimateSchema).default([]),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([]),
  validationPlanRefs: exports_external.array(ResourcePointerSchema).default([]),
  proofBundleRefs: exports_external.array(ResourcePointerSchema).default([])
}).strict().superRefine((value, ctx) => {
  if (value.startedAt && value.finishedAt && Date.parse(value.finishedAt) < Date.parse(value.startedAt)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "finishedAt must be after or equal to startedAt",
      path: ["finishedAt"]
    });
  }
  if (TerminalStatuses.has(value.status) && !value.finishedAt) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Terminal work runs require finishedAt",
      path: ["finishedAt"]
    });
  }
  const hasEvidence = value.evidenceRefs.length > 0 || value.proofBundleRefs.length > 0;
  if (value.status === "succeeded" && !hasEvidence) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Succeeded work runs require evidence or a proof bundle",
      path: ["evidenceRefs"]
    });
  }
  if ((value.status === "failed" || value.status === "blocked") && !hasEvidence && value.decisions.length === 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Failed or blocked work runs require evidence, a proof bundle, or a decision record",
      path: ["evidenceRefs"]
    });
  }
});
var TASK_TO_PR_ROLE_AUTHORITIES = Object.freeze({
  work_run: Object.freeze(["codewith"]),
  root_request: Object.freeze(["todos"]),
  pr_group: Object.freeze(["todos"]),
  leaf_task: Object.freeze(["todos"]),
  attempt: Object.freeze(["todos"]),
  writer_generation: Object.freeze(["todos"]),
  writer_lease: Object.freeze(["repos"]),
  writer_fence: Object.freeze(["repos"]),
  provider_profile: Object.freeze(["codewith"]),
  provider_route: Object.freeze(["codewith"]),
  admission: Object.freeze(["codewith"]),
  worker_actor: Object.freeze(["codewith"]),
  worker: Object.freeze(["codewith"]),
  runtime: Object.freeze(["codewith"]),
  repo: Object.freeze(["repos"]),
  worktree: Object.freeze(["repos"]),
  branch: Object.freeze(["repos"]),
  event_stream: Object.freeze(["todos"]),
  replay_cursor: Object.freeze(["todos"]),
  handoff: Object.freeze(["todos"]),
  pull_request: Object.freeze(["todos"]),
  commit: Object.freeze(["repos"]),
  review: Object.freeze(["review"]),
  reviewer: Object.freeze(["review"]),
  review_run: Object.freeze(["review"]),
  proof_bundle: Object.freeze(["review"]),
  repair_cycle: Object.freeze(["todos"]),
  merge_guard: Object.freeze(["todos"]),
  merge_operator: Object.freeze(["merge_provider"]),
  merge_operator_run: Object.freeze(["merge_provider"]),
  merge_guard_receipt: Object.freeze(["merge_provider"]),
  merge_outcome: Object.freeze(["merge_provider"]),
  recovery: Object.freeze(["todos"]),
  cancellation: Object.freeze(["todos"]),
  cleanup_eligibility: Object.freeze(["repos"]),
  cleanup_outcome: Object.freeze(["repos"]),
  rollback_plan: Object.freeze(["todos"]),
  rollback_outcome: Object.freeze(["repos"]),
  terminal_disposition: Object.freeze(["todos"]),
  openloops_invocation: Object.freeze(["openloops"]),
  adapter_extension: Object.freeze(["adapter"])
});
var TaskToPrRefRoleSchema = exports_external.enum([
  "work_run",
  "root_request",
  "pr_group",
  "leaf_task",
  "attempt",
  "writer_generation",
  "writer_lease",
  "writer_fence",
  "provider_profile",
  "provider_route",
  "admission",
  "worker_actor",
  "worker",
  "runtime",
  "repo",
  "worktree",
  "branch",
  "event_stream",
  "replay_cursor",
  "handoff",
  "pull_request",
  "commit",
  "review",
  "reviewer",
  "review_run",
  "proof_bundle",
  "repair_cycle",
  "merge_guard",
  "merge_operator",
  "merge_operator_run",
  "merge_guard_receipt",
  "merge_outcome",
  "recovery",
  "cancellation",
  "cleanup_eligibility",
  "cleanup_outcome",
  "rollback_plan",
  "rollback_outcome",
  "terminal_disposition",
  "openloops_invocation",
  "adapter_extension"
]);
var TaskToPrAuthoritySchema = exports_external.enum([
  "todos",
  "codewith",
  "repos",
  "review",
  "merge_provider",
  "openloops",
  "adapter"
]);
var LowerSha256DigestSchema = exports_external.string().regex(/^[a-f0-9]{64}$/);
var OpaqueTaskToPrIdSchema = exports_external.string().trim().min(3).max(256);
var NonsemanticOpaqueSuffixPattern = /^[a-f0-9]{32}$/;
function deriveTaskToPrRefId(role, authority, digest) {
  return `${role}:${authority}:opaque-${digest.slice(0, 32)}`;
}
function deriveTaskToPrEvidenceId(digest) {
  return `evidence:opaque-${digest.slice(0, 32)}`;
}
var TaskToPrProjectionIdSchema = OpaqueTaskToPrIdSchema.refine((value) => {
  const prefix = "task_to_pr_projection:opaque-";
  const suffix = value.startsWith(prefix) ? value.slice(prefix.length) : "";
  return NonsemanticOpaqueSuffixPattern.test(suffix);
}, "Projection ids must use a nonsemantic 128-bit lowercase hexadecimal surrogate");
var TaskToPrAttemptNonceSchema = OpaqueTaskToPrIdSchema.refine((value) => {
  const prefix = "attempt_nonce:opaque-";
  const suffix = value.startsWith(prefix) ? value.slice(prefix.length) : "";
  return NonsemanticOpaqueSuffixPattern.test(suffix);
}, "Attempt nonces must use a nonsemantic 128-bit lowercase hexadecimal surrogate");
var SensitiveTaskToPrRoles = new Set([
  "writer_lease",
  "writer_fence",
  "provider_profile",
  "provider_route",
  "admission",
  "worker_actor",
  "worker",
  "runtime",
  "worktree",
  "merge_operator",
  "merge_operator_run",
  "merge_guard_receipt",
  "merge_outcome",
  "openloops_invocation",
  "adapter_extension"
]);
var TaskToPrRefSchema = exports_external.object({
  role: TaskToPrRefRoleSchema,
  authority: TaskToPrAuthoritySchema,
  id: OpaqueTaskToPrIdSchema,
  digest: LowerSha256DigestSchema,
  redaction: exports_external.enum(["none", "partial", "full"])
}).strict().superRefine((value, ctx) => {
  const allowedAuthorities = TASK_TO_PR_ROLE_AUTHORITIES[value.role];
  if (!allowedAuthorities.includes(value.authority)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: `${value.role} refs must be owned by ${allowedAuthorities.join(" or ")}`,
      path: ["authority"]
    });
  }
  if (SensitiveTaskToPrRoles.has(value.role) && value.redaction === "none") {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: `${value.role} refs must be redacted and cannot carry a raw locator or credential`,
      path: ["redaction"]
    });
  }
  const expectedId = deriveTaskToPrRefId(value.role, value.authority, value.digest);
  if (value.id !== expectedId) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Reference ids must be nonsemantic authority-bound surrogates derived from the canonical role, authority, and owner-record digest",
      path: ["id"]
    });
  }
});
var TaskToPrEvidenceRefSchema = exports_external.object({
  id: OpaqueTaskToPrIdSchema,
  digest: LowerSha256DigestSchema,
  redaction: exports_external.enum(["partial", "full"])
}).strict().superRefine((value, ctx) => {
  if (value.id !== deriveTaskToPrEvidenceId(value.digest)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Evidence ids must be nonsemantic owner-resolvable surrogates derived from their canonical digest",
      path: ["id"]
    });
  }
});
function requireDistinctTaskToPrEvidenceRefs(stopEvidenceRef, leaseRevocationEvidenceRef, ctx, path) {
  if (stopEvidenceRef.id === leaseRevocationEvidenceRef.id || stopEvidenceRef.digest === leaseRevocationEvidenceRef.digest) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Stop and lease-revocation facts require distinct evidence identities and digests",
      path
    });
  }
}
function taskToPrRefFor(role) {
  return TaskToPrRefSchema.refine((value) => value.role === role, {
    message: `Reference must use role ${role}`,
    path: ["role"]
  });
}
function sameTaskToPrRef(left, right) {
  return left.role === right.role && left.authority === right.authority && left.id === right.id && left.digest === right.digest && left.redaction === right.redaction;
}
function sameTaskToPrCanonicalRefId(left, right) {
  return left.role === right.role && left.authority === right.authority && left.id === right.id;
}
function requireFreshTaskToPrRef(prior, successor, ctx, path, label) {
  if (sameTaskToPrCanonicalRefId(prior, successor)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: `${label} requires a fresh canonical role/authority/id`,
      path
    });
  }
  if (prior.digest === successor.digest) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: `${label} requires a fresh canonical digest`,
      path
    });
  }
}
function taskToPrCanonicalRefKey(ref) {
  return `${ref.role}\x00${ref.authority}\x00${ref.id}`;
}
function sameGitObjectId(left, right) {
  return left.algorithm === right.algorithm && left.value === right.value;
}
var TaskToPrGitObjectIdSchema = exports_external.object({
  algorithm: exports_external.enum(["sha1", "sha256"]),
  value: exports_external.string().regex(/^[a-f0-9]+$/)
}).strict().superRefine((value, ctx) => {
  const requiredLength = value.algorithm === "sha1" ? 40 : 64;
  if (value.value.length !== requiredLength) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: `${value.algorithm} object ids must contain exactly ${requiredLength} lowercase hex characters`,
      path: ["value"]
    });
  }
});
function deriveTaskToPrIdentityDigest(input) {
  if (input.canonicalizationVersion === 1) {
    const legacyCanonicalBinding = JSON.stringify([
      "hasna.task_to_pr_projection.binding.v1",
      input.canonicalizationVersion,
      input.rootRequestRef.id,
      input.rootRequestRef.digest,
      input.prGroupRef.id,
      input.prGroupRef.digest,
      input.leafTaskRef.id,
      input.leafTaskRef.digest,
      input.repoRef.id,
      input.repoRef.digest,
      input.baseHead.algorithm,
      input.baseHead.value,
      input.frozenScopeDigest
    ]);
    return createHash2("sha256").update(legacyCanonicalBinding, "utf8").digest("hex");
  }
  const canonicalBinding = JSON.stringify([
    "hasna.task_to_pr_projection.binding.v2",
    input.canonicalizationVersion,
    ...[input.rootRequestRef, input.prGroupRef, input.leafTaskRef, input.repoRef, input.worktreeRef, input.branchRef].flatMap((ref) => [ref.role, ref.authority, ref.id, ref.digest]),
    input.baseHead.algorithm,
    input.baseHead.value,
    input.frozenScopeDigest
  ]);
  return createHash2("sha256").update(canonicalBinding, "utf8").digest("hex");
}
var TaskToPrAttemptSchema = exports_external.object({
  ref: taskToPrRefFor("attempt"),
  nonce: TaskToPrAttemptNonceSchema,
  admissionRef: taskToPrRefFor("admission"),
  admissionWriterGenerationRef: taskToPrRefFor("writer_generation"),
  workerActorRef: taskToPrRefFor("worker_actor"),
  workerRef: taskToPrRefFor("worker"),
  runtimeRef: taskToPrRefFor("runtime"),
  writerGenerationRef: taskToPrRefFor("writer_generation"),
  writerLeaseRef: taskToPrRefFor("writer_lease"),
  writerFenceRef: taskToPrRefFor("writer_fence"),
  providerProfileRef: taskToPrRefFor("provider_profile"),
  providerRouteRef: taskToPrRefFor("provider_route")
}).strict();
var TaskToPrRepositoryBindingSchema = exports_external.object({
  repoRef: taskToPrRefFor("repo"),
  worktreeRef: taskToPrRefFor("worktree"),
  branchRef: taskToPrRefFor("branch"),
  baseHead: TaskToPrGitObjectIdSchema,
  branchHead: TaskToPrGitObjectIdSchema
}).strict();
var TaskToPrEventCursorSchema = exports_external.object({
  streamRef: taskToPrRefFor("event_stream"),
  replayCursorRef: taskToPrRefFor("replay_cursor"),
  sequence: exports_external.number().int().safe().nonnegative(),
  prefixDigest: LowerSha256DigestSchema
}).strict();
var TaskToPrHandoffSchema = exports_external.object({
  ref: taskToPrRefFor("handoff"),
  previousAttemptRef: taskToPrRefFor("attempt"),
  nextAttemptRef: taskToPrRefFor("attempt"),
  previousWriterGenerationRef: taskToPrRefFor("writer_generation"),
  nextWriterGenerationRef: taskToPrRefFor("writer_generation"),
  stoppedWorkRunRef: taskToPrRefFor("work_run"),
  stopEvidenceRef: TaskToPrEvidenceRefSchema,
  leaseRevocationEvidenceRef: TaskToPrEvidenceRefSchema
}).strict().superRefine((value, ctx) => {
  requireFreshTaskToPrRef(value.previousAttemptRef, value.nextAttemptRef, ctx, ["nextAttemptRef"], "Handoff attempt rotation");
  requireFreshTaskToPrRef(value.previousWriterGenerationRef, value.nextWriterGenerationRef, ctx, ["nextWriterGenerationRef"], "Handoff writer-generation rotation");
  requireDistinctTaskToPrEvidenceRefs(value.stopEvidenceRef, value.leaseRevocationEvidenceRef, ctx, ["leaseRevocationEvidenceRef"]);
});
var TaskToPrReviewBindingSchema = exports_external.object({
  ref: taskToPrRefFor("review"),
  pullRequestRef: taskToPrRefFor("pull_request"),
  base: TaskToPrGitObjectIdSchema,
  head: TaskToPrGitObjectIdSchema,
  reviewerRef: taskToPrRefFor("reviewer"),
  reviewRunRef: taskToPrRefFor("review_run"),
  proofBundleRef: taskToPrRefFor("proof_bundle"),
  verdict: exports_external.enum(["approved", "changes_requested", "blocked"]),
  reviewedAt: TimestampSchema
}).strict();
var TaskToPrExactHeadBindingSchema = exports_external.object({
  pullRequestRef: taskToPrRefFor("pull_request"),
  remoteBranchRef: taskToPrRefFor("branch"),
  expectedBase: TaskToPrGitObjectIdSchema,
  providerPullRequestBase: TaskToPrGitObjectIdSchema,
  localHead: TaskToPrGitObjectIdSchema,
  remoteHead: TaskToPrGitObjectIdSchema,
  providerPullRequestHead: TaskToPrGitObjectIdSchema,
  equalityProofRef: taskToPrRefFor("proof_bundle"),
  ciProofBundleRefs: exports_external.array(taskToPrRefFor("proof_bundle")).min(1),
  verifiedAt: TimestampSchema
}).strict().superRefine((value, ctx) => {
  if (!sameGitObjectId(value.expectedBase, value.providerPullRequestBase)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Expected and provider-observed pull-request bases must be exactly equal",
      path: ["providerPullRequestBase"]
    });
  }
  if (!sameGitObjectId(value.localHead, value.remoteHead) || !sameGitObjectId(value.localHead, value.providerPullRequestHead)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Local, remote, and provider pull-request heads must be exactly equal",
      path: ["providerPullRequestHead"]
    });
  }
  const proofKeys = value.ciProofBundleRefs.map(taskToPrCanonicalRefKey);
  if (new Set(proofKeys).size !== proofKeys.length) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "CI proof bundle refs must have unique canonical identities",
      path: ["ciProofBundleRefs"]
    });
  }
  const proofDigests = value.ciProofBundleRefs.map((ref) => ref.digest);
  if (new Set(proofDigests).size !== proofDigests.length) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "CI proof bundle refs must have unique canonical digests",
      path: ["ciProofBundleRefs"]
    });
  }
  if (value.ciProofBundleRefs.some((ref) => sameTaskToPrCanonicalRefId(ref, value.equalityProofRef))) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Head-equality and CI proof refs must have distinct canonical identities",
      path: ["ciProofBundleRefs"]
    });
  }
  if (value.ciProofBundleRefs.some((ref) => ref.digest === value.equalityProofRef.digest)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Head-equality and CI proof refs must have distinct canonical digests",
      path: ["ciProofBundleRefs"]
    });
  }
});
var TaskToPrRepairStateSchema = exports_external.object({
  ref: taskToPrRefFor("repair_cycle"),
  cycle: exports_external.number().int().min(0).max(2),
  cap: exports_external.literal(2),
  exhausted: exports_external.boolean(),
  latestRepairRef: taskToPrRefFor("repair_cycle").optional()
}).strict().superRefine((value, ctx) => {
  if (value.exhausted !== (value.cycle === value.cap)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Repair exhaustion must equal the cumulative cycle cap",
      path: ["exhausted"]
    });
  }
  if (value.cycle === 0 && value.latestRepairRef) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Cycle zero cannot reference a repair",
      path: ["latestRepairRef"]
    });
  }
  if (value.cycle > 0 && !value.latestRepairRef) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Non-zero repair state requires the latest immutable repair ref",
      path: ["latestRepairRef"]
    });
  }
  if (value.latestRepairRef && sameTaskToPrCanonicalRefId(value.ref, value.latestRepairRef)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Repair-state and latest-repair refs must be distinct canonical records",
      path: ["latestRepairRef"]
    });
  }
  if (value.latestRepairRef && value.ref.digest === value.latestRepairRef.digest) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Repair-state and latest-repair refs must have distinct canonical digests",
      path: ["latestRepairRef"]
    });
  }
});
var TaskToPrMergeGuardSchema = exports_external.object({
  ref: taskToPrRefFor("merge_guard"),
  pullRequestRef: taskToPrRefFor("pull_request"),
  expectedBase: TaskToPrGitObjectIdSchema,
  expectedHead: TaskToPrGitObjectIdSchema,
  reviewRefs: exports_external.array(taskToPrRefFor("review")).min(1),
  proofBundleRefs: exports_external.array(taskToPrRefFor("proof_bundle")).min(1),
  operatorRef: taskToPrRefFor("merge_operator"),
  operatorRunRef: taskToPrRefFor("merge_operator_run"),
  providerGuardReceiptRef: taskToPrRefFor("merge_guard_receipt"),
  mechanism: exports_external.enum(["compare_and_swap", "queue_expected_head"]),
  decision: exports_external.enum(["eligible", "denied", "consumed", "revoked"]),
  evaluatedAt: TimestampSchema
}).strict().superRefine((value, ctx) => {
  const uniqueReviews = new Set(value.reviewRefs.map((ref) => ref.id));
  if (uniqueReviews.size !== value.reviewRefs.length) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Merge guard review refs must be unique",
      path: ["reviewRefs"]
    });
  }
  const uniqueProofs = new Set(value.proofBundleRefs.map(taskToPrCanonicalRefKey));
  if (uniqueProofs.size !== value.proofBundleRefs.length) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Merge guard proof refs must have unique canonical identities",
      path: ["proofBundleRefs"]
    });
  }
  const uniqueProofDigests = new Set(value.proofBundleRefs.map((ref) => ref.digest));
  if (uniqueProofDigests.size !== value.proofBundleRefs.length) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Merge guard proof refs must have unique canonical digests",
      path: ["proofBundleRefs"]
    });
  }
});
var TaskToPrMergeOutcomeSchema = exports_external.object({
  ref: taskToPrRefFor("merge_outcome"),
  guardRef: taskToPrRefFor("merge_guard"),
  pullRequestRef: taskToPrRefFor("pull_request"),
  expectedBase: TaskToPrGitObjectIdSchema,
  observedBase: TaskToPrGitObjectIdSchema,
  expectedHead: TaskToPrGitObjectIdSchema,
  observedHead: TaskToPrGitObjectIdSchema,
  status: exports_external.enum(["merged", "closed_unmerged", "refused", "head_drift", "base_drift"]),
  mergeCommitRef: taskToPrRefFor("commit").optional(),
  finishedAt: TimestampSchema,
  evidenceRefs: exports_external.array(TaskToPrEvidenceRefSchema).min(1)
}).strict().superRefine((value, ctx) => {
  const baseMatches = sameGitObjectId(value.expectedBase, value.observedBase);
  const headMatches = sameGitObjectId(value.expectedHead, value.observedHead);
  if (value.status === "merged") {
    if (!baseMatches || !headMatches) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Merged outcomes require observed base and head to equal the guarded values",
        path: [!baseMatches ? "observedBase" : "observedHead"]
      });
    }
    if (!value.mergeCommitRef) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Merged outcomes require an immutable merge commit ref",
        path: ["mergeCommitRef"]
      });
    }
  } else if (value.mergeCommitRef) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Unmerged outcomes cannot claim a merge commit",
      path: ["mergeCommitRef"]
    });
  }
  if (value.status === "head_drift" && headMatches) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Head-drift outcomes require distinct expected and observed heads",
      path: ["observedHead"]
    });
  }
  if (value.status === "head_drift" && !baseMatches) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Head-drift outcomes cannot also carry an unclassified base drift",
      path: ["observedBase"]
    });
  }
  if (value.status === "base_drift" && baseMatches) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Base-drift outcomes require distinct expected and observed bases",
      path: ["observedBase"]
    });
  }
  if (value.status === "base_drift" && !headMatches) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Base-drift outcomes cannot also carry an unclassified head drift",
      path: ["observedHead"]
    });
  }
  if (!headMatches && value.status !== "head_drift") {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Only a head_drift outcome may record an observed head that differs from the expected head",
      path: ["observedHead"]
    });
  }
  if (!baseMatches && value.status !== "base_drift") {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Only a base_drift outcome may record an observed base that differs from the expected base",
      path: ["observedBase"]
    });
  }
});
var TaskToPrMergeStateSchema = exports_external.object({
  guard: TaskToPrMergeGuardSchema,
  outcome: TaskToPrMergeOutcomeSchema.optional()
}).strict();
var TaskToPrRecoverySchema = exports_external.object({
  ref: taskToPrRefFor("recovery"),
  priorAttemptRef: taskToPrRefFor("attempt"),
  priorWriterGenerationRef: taskToPrRefFor("writer_generation"),
  priorWorkRunRef: taskToPrRefFor("work_run"),
  successorAttemptNonce: TaskToPrAttemptNonceSchema,
  successorWriterGenerationRef: taskToPrRefFor("writer_generation"),
  preservedStateRefs: exports_external.array(TaskToPrRefSchema).min(1),
  stopEvidenceRef: TaskToPrEvidenceRefSchema,
  leaseRevocationEvidenceRef: TaskToPrEvidenceRefSchema
}).strict().superRefine((value, ctx) => {
  requireFreshTaskToPrRef(value.priorWriterGenerationRef, value.successorWriterGenerationRef, ctx, ["successorWriterGenerationRef"], "Recovery writer-generation rotation");
  requireDistinctTaskToPrEvidenceRefs(value.stopEvidenceRef, value.leaseRevocationEvidenceRef, ctx, ["leaseRevocationEvidenceRef"]);
});
var TaskToPrCancellationSchema = exports_external.object({
  ref: taskToPrRefFor("cancellation"),
  cancelledAttemptRef: taskToPrRefFor("attempt"),
  preservedStateRefs: exports_external.array(TaskToPrRefSchema).min(1),
  evidenceRefs: exports_external.array(TaskToPrEvidenceRefSchema).min(1)
}).strict();
var TaskToPrCleanupEligibilitySchema = exports_external.object({
  ref: taskToPrRefFor("cleanup_eligibility"),
  status: exports_external.enum(["not_ready", "preserved", "blocked", "eligible"]),
  targetWorktreeRef: taskToPrRefFor("worktree"),
  eventCursorRef: taskToPrRefFor("replay_cursor"),
  terminalDispositionRef: taskToPrRefFor("terminal_disposition"),
  writerLeaseRef: taskToPrRefFor("writer_lease"),
  leaseRevocationEvidenceRef: TaskToPrEvidenceRefSchema,
  consumedEventEvidenceRef: TaskToPrEvidenceRefSchema,
  evaluatedAt: TimestampSchema,
  evidenceRefs: exports_external.array(TaskToPrEvidenceRefSchema).min(1)
}).strict().superRefine((value, ctx) => {
  if (value.leaseRevocationEvidenceRef.id === value.consumedEventEvidenceRef.id || value.leaseRevocationEvidenceRef.digest === value.consumedEventEvidenceRef.digest) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Cleanup lease-revocation and consumed-event facts require distinct evidence identities and digests",
      path: ["consumedEventEvidenceRef"]
    });
  }
});
var TaskToPrCleanupOutcomeSchema = exports_external.object({
  ref: taskToPrRefFor("cleanup_outcome"),
  eligibilityRef: taskToPrRefFor("cleanup_eligibility"),
  targetWorktreeRef: taskToPrRefFor("worktree"),
  status: exports_external.enum(["preserved", "deleted", "failed", "skipped"]),
  finishedAt: TimestampSchema,
  evidenceRefs: exports_external.array(TaskToPrEvidenceRefSchema).min(1)
}).strict();
var TaskToPrCleanupStateSchema = exports_external.object({
  eligibility: TaskToPrCleanupEligibilitySchema,
  outcome: TaskToPrCleanupOutcomeSchema.optional()
}).strict().superRefine((value, ctx) => {
  if (value.outcome && !sameTaskToPrRef(value.outcome.eligibilityRef, value.eligibility.ref)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Cleanup outcomes must bind the exact eligibility decision",
      path: ["outcome", "eligibilityRef"]
    });
  }
  if (value.outcome && !sameTaskToPrRef(value.outcome.targetWorktreeRef, value.eligibility.targetWorktreeRef)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Cleanup eligibility and outcome must bind the same target worktree",
      path: ["outcome", "targetWorktreeRef"]
    });
  }
  if (value.outcome?.status === "deleted" && value.eligibility.status !== "eligible") {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Deletion requires an eligible cleanup decision",
      path: ["outcome", "status"]
    });
  }
});
var TaskToPrRollbackSchema = exports_external.object({
  plan: exports_external.object({
    ref: taskToPrRefFor("rollback_plan"),
    targetRef: exports_external.union([taskToPrRefFor("commit"), taskToPrRefFor("branch")]),
    createdAt: TimestampSchema
  }).strict(),
  outcome: exports_external.object({
    ref: taskToPrRefFor("rollback_outcome"),
    planRef: taskToPrRefFor("rollback_plan"),
    targetRef: exports_external.union([taskToPrRefFor("commit"), taskToPrRefFor("branch")]),
    status: exports_external.enum(["not_run", "succeeded", "failed", "cancelled"]),
    finishedAt: TimestampSchema,
    evidenceRefs: exports_external.array(TaskToPrEvidenceRefSchema).min(1)
  }).strict().optional()
}).strict().superRefine((value, ctx) => {
  if (value.outcome && !sameTaskToPrRef(value.outcome.planRef, value.plan.ref)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Rollback outcomes must bind the exact rollback plan",
      path: ["outcome", "planRef"]
    });
  }
  if (value.outcome && !sameTaskToPrRef(value.outcome.targetRef, value.plan.targetRef)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Rollback outcomes must bind the exact rollback target",
      path: ["outcome", "targetRef"]
    });
  }
  if (value.outcome && Date.parse(value.outcome.finishedAt) < Date.parse(value.plan.createdAt)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Rollback outcomes cannot finish before their plan was created",
      path: ["outcome", "finishedAt"]
    });
  }
});
var TaskToPrProvenanceEntrySchema = exports_external.discriminatedUnion("category", [
  exports_external.object({
    category: exports_external.literal("projection_id"),
    projectionId: TaskToPrProjectionIdSchema
  }).strict(),
  exports_external.object({
    category: exports_external.literal("work_run"),
    ref: taskToPrRefFor("work_run")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("attempt"),
    ref: taskToPrRefFor("attempt")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("admission"),
    ref: taskToPrRefFor("admission")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("worker_actor"),
    ref: taskToPrRefFor("worker_actor")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("worker_assignment"),
    ref: taskToPrRefFor("worker")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("attempt_nonce"),
    nonce: TaskToPrAttemptNonceSchema
  }).strict(),
  exports_external.object({
    category: exports_external.literal("runtime"),
    ref: taskToPrRefFor("runtime")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("writer_generation"),
    ref: taskToPrRefFor("writer_generation")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("writer_lease"),
    ref: taskToPrRefFor("writer_lease")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("writer_fence"),
    ref: taskToPrRefFor("writer_fence")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("provider_profile"),
    ref: taskToPrRefFor("provider_profile")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("provider_route"),
    ref: taskToPrRefFor("provider_route")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("replay_cursor"),
    ref: taskToPrRefFor("replay_cursor")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("replay_prefix"),
    sequence: exports_external.number().int().safe().nonnegative(),
    prefixDigest: LowerSha256DigestSchema
  }).strict(),
  exports_external.object({
    category: exports_external.literal("repair_state"),
    ref: taskToPrRefFor("repair_cycle")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("latest_repair"),
    ref: taskToPrRefFor("repair_cycle")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("handoff"),
    ref: taskToPrRefFor("handoff")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("recovery"),
    ref: taskToPrRefFor("recovery")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("merge_guard"),
    ref: taskToPrRefFor("merge_guard")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("cleanup_eligibility"),
    ref: taskToPrRefFor("cleanup_eligibility")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("rollback_plan"),
    ref: taskToPrRefFor("rollback_plan")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("terminal_disposition"),
    ref: taskToPrRefFor("terminal_disposition")
  }).strict(),
  exports_external.object({
    category: exports_external.literal("equality_proof"),
    ref: taskToPrRefFor("proof_bundle"),
    base: TaskToPrGitObjectIdSchema,
    head: TaskToPrGitObjectIdSchema
  }).strict(),
  exports_external.object({
    category: exports_external.literal("ci_proof"),
    ref: taskToPrRefFor("proof_bundle"),
    base: TaskToPrGitObjectIdSchema,
    head: TaskToPrGitObjectIdSchema
  }).strict(),
  exports_external.object({
    category: exports_external.literal("review_proof"),
    ref: taskToPrRefFor("proof_bundle"),
    base: TaskToPrGitObjectIdSchema,
    head: TaskToPrGitObjectIdSchema
  }).strict(),
  exports_external.object({
    category: exports_external.literal("review_record"),
    ref: taskToPrRefFor("review"),
    base: TaskToPrGitObjectIdSchema,
    head: TaskToPrGitObjectIdSchema
  }).strict(),
  exports_external.object({
    category: exports_external.literal("review_run"),
    ref: taskToPrRefFor("review_run"),
    base: TaskToPrGitObjectIdSchema,
    head: TaskToPrGitObjectIdSchema
  }).strict(),
  exports_external.object({
    category: exports_external.literal("provider_guard_receipt"),
    ref: taskToPrRefFor("merge_guard_receipt"),
    base: TaskToPrGitObjectIdSchema,
    head: TaskToPrGitObjectIdSchema
  }).strict()
]);
function taskToPrActiveProvenanceEntries(projection) {
  return [
    {
      category: "projection_id",
      projectionId: projection.id
    },
    {
      category: "work_run",
      ref: projection.workRunRef
    },
    {
      category: "attempt",
      ref: projection.attempt.ref
    },
    {
      category: "admission",
      ref: projection.attempt.admissionRef
    },
    {
      category: "worker_actor",
      ref: projection.attempt.workerActorRef
    },
    {
      category: "worker_assignment",
      ref: projection.attempt.workerRef
    },
    {
      category: "attempt_nonce",
      nonce: projection.attempt.nonce
    },
    {
      category: "runtime",
      ref: projection.attempt.runtimeRef
    },
    {
      category: "writer_generation",
      ref: projection.attempt.writerGenerationRef
    },
    {
      category: "writer_lease",
      ref: projection.attempt.writerLeaseRef
    },
    {
      category: "writer_fence",
      ref: projection.attempt.writerFenceRef
    },
    {
      category: "provider_profile",
      ref: projection.attempt.providerProfileRef
    },
    {
      category: "provider_route",
      ref: projection.attempt.providerRouteRef
    },
    {
      category: "replay_cursor",
      ref: projection.events.replayCursorRef
    },
    {
      category: "replay_prefix",
      sequence: projection.events.sequence,
      prefixDigest: projection.events.prefixDigest
    },
    {
      category: "repair_state",
      ref: projection.repair.ref
    },
    ...projection.repair.latestRepairRef ? [
      {
        category: "latest_repair",
        ref: projection.repair.latestRepairRef
      }
    ] : [],
    ...projection.handoff ? [{ category: "handoff", ref: projection.handoff.ref }] : [],
    ...projection.recovery ? [{ category: "recovery", ref: projection.recovery.ref }] : [],
    ...projection.exactHead ? [
      {
        category: "equality_proof",
        ref: projection.exactHead.equalityProofRef,
        base: projection.exactHead.expectedBase,
        head: projection.exactHead.localHead
      },
      ...projection.exactHead.ciProofBundleRefs.map((ref) => ({
        category: "ci_proof",
        ref,
        base: projection.exactHead.expectedBase,
        head: projection.exactHead.localHead
      }))
    ] : [],
    ...projection.reviews.flatMap((review) => [
      {
        category: "review_proof",
        ref: review.proofBundleRef,
        base: review.base,
        head: review.head
      },
      {
        category: "review_record",
        ref: review.ref,
        base: review.base,
        head: review.head
      },
      {
        category: "review_run",
        ref: review.reviewRunRef,
        base: review.base,
        head: review.head
      }
    ]),
    ...projection.merge ? [
      {
        category: "merge_guard",
        ref: projection.merge.guard.ref
      },
      {
        category: "provider_guard_receipt",
        ref: projection.merge.guard.providerGuardReceiptRef,
        base: projection.merge.guard.expectedBase,
        head: projection.merge.guard.expectedHead
      }
    ] : [],
    ...projection.cleanup ? [
      {
        category: "cleanup_eligibility",
        ref: projection.cleanup.eligibility.ref
      }
    ] : [],
    ...projection.rollback ? [
      {
        category: "rollback_plan",
        ref: projection.rollback.plan.ref
      }
    ] : [],
    ...projection.terminalDispositionRef ? [
      {
        category: "terminal_disposition",
        ref: projection.terminalDispositionRef
      }
    ] : []
  ];
}
function sameTaskToPrProvenanceEntry(left, right) {
  if (left.category !== right.category) {
    return false;
  }
  if (left.category === "projection_id" && right.category === "projection_id") {
    return left.projectionId === right.projectionId;
  }
  if (left.category === "attempt_nonce" && right.category === "attempt_nonce") {
    return left.nonce === right.nonce;
  }
  if (left.category === "replay_prefix" && right.category === "replay_prefix") {
    return left.sequence === right.sequence && left.prefixDigest === right.prefixDigest;
  }
  if (!("ref" in left) || !("ref" in right)) {
    return false;
  }
  return sameTaskToPrRef(left.ref, right.ref) && (("head" in left) && ("head" in right) && ("base" in left) && ("base" in right) && sameGitObjectId(left.base, right.base) && sameGitObjectId(left.head, right.head) || !("head" in left) && !("head" in right) && !("base" in left) && !("base" in right));
}
var TASK_TO_PR_V1_ADAPTER_EXTENSION_SCHEMA_PREFIX = "hasna.task_to_pr_adapter_extension.";
var TaskToPrAdapterExtensionSchema = exports_external.object({
  schema: SchemaIdSchema,
  ref: taskToPrRefFor("adapter_extension"),
  digest: LowerSha256DigestSchema
}).strict().superRefine((value, ctx) => {
  if (!value.schema.startsWith(TASK_TO_PR_V1_ADAPTER_EXTENSION_SCHEMA_PREFIX)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Adapter extension schema ids must use the permanently reserved task-to-PR adapter-extension namespace",
      path: ["schema"]
    });
  }
});
var TaskToPrProjectionStateSchema = exports_external.enum([
  "admitted",
  "running",
  "handed_off",
  "reviewing",
  "repairing",
  "merge_ready",
  "merged",
  "closed_unmerged",
  "failed",
  "blocked",
  "cancelled",
  "recovering",
  "cleanup_complete",
  "rolled_back"
]);
var TaskToPrStatesWithoutReviewAuthority = new Set([
  "admitted",
  "running",
  "handed_off"
]);
var TaskToPrTerminalStates = new Set([
  "merged",
  "closed_unmerged",
  "failed",
  "blocked",
  "cancelled",
  "cleanup_complete",
  "rolled_back"
]);
var TASK_TO_PR_STATE_MERGE_MATRIX = {
  admitted: new Set(["absent", "denied:none", "revoked:none"]),
  running: new Set(["absent", "denied:none", "revoked:none"]),
  handed_off: new Set(["absent", "denied:none", "revoked:none"]),
  reviewing: new Set(["absent", "denied:none", "revoked:none"]),
  repairing: new Set(["absent", "denied:none", "revoked:none"]),
  merge_ready: new Set(["eligible:none"]),
  merged: new Set(["consumed:merged"]),
  closed_unmerged: new Set([
    "consumed:closed_unmerged",
    "consumed:refused",
    "consumed:head_drift",
    "consumed:base_drift"
  ]),
  failed: new Set(["absent", "revoked:none"]),
  blocked: new Set(["absent", "revoked:none"]),
  cancelled: new Set(["absent", "revoked:none"]),
  recovering: new Set(["absent", "denied:none", "revoked:none"]),
  cleanup_complete: new Set([
    "absent",
    "revoked:none",
    "consumed:merged",
    "consumed:closed_unmerged",
    "consumed:refused",
    "consumed:head_drift",
    "consumed:base_drift"
  ]),
  rolled_back: new Set(["consumed:merged"])
};
var TaskToPrProjectionSchema = exports_external.object({
  schema: exports_external.literal(SCHEMA_IDS.taskToPrProjection),
  id: TaskToPrProjectionIdSchema,
  createdAt: TimestampSchema,
  canonicalizationVersion: exports_external.union([exports_external.literal(1), exports_external.literal(2)]),
  identityDigest: LowerSha256DigestSchema,
  frozenScopeDigest: LowerSha256DigestSchema,
  state: TaskToPrProjectionStateSchema,
  workRunRef: taskToPrRefFor("work_run"),
  rootRequestRef: taskToPrRefFor("root_request"),
  prGroupRef: taskToPrRefFor("pr_group"),
  leafTaskRef: taskToPrRefFor("leaf_task"),
  attempt: TaskToPrAttemptSchema,
  repository: TaskToPrRepositoryBindingSchema,
  events: TaskToPrEventCursorSchema,
  openLoopsInvocationRef: taskToPrRefFor("openloops_invocation").optional(),
  pullRequestRef: taskToPrRefFor("pull_request").optional(),
  exactHead: TaskToPrExactHeadBindingSchema.optional(),
  handoff: TaskToPrHandoffSchema.optional(),
  reviews: exports_external.array(TaskToPrReviewBindingSchema).default([]),
  repair: TaskToPrRepairStateSchema,
  merge: TaskToPrMergeStateSchema.optional(),
  recovery: TaskToPrRecoverySchema.optional(),
  cancellation: TaskToPrCancellationSchema.optional(),
  cleanup: TaskToPrCleanupStateSchema.optional(),
  rollback: TaskToPrRollbackSchema.optional(),
  terminalDispositionRef: taskToPrRefFor("terminal_disposition").optional(),
  provenanceLedger: exports_external.array(TaskToPrProvenanceEntrySchema),
  adapterExtensions: exports_external.array(TaskToPrAdapterExtensionSchema).default([]),
  evidenceRefs: exports_external.array(TaskToPrEvidenceRefSchema).default([])
}).strict().superRefine((value, ctx) => {
  const derivedIdentityDigest = value.canonicalizationVersion === 1 ? deriveTaskToPrIdentityDigest({
    canonicalizationVersion: 1,
    rootRequestRef: value.rootRequestRef,
    prGroupRef: value.prGroupRef,
    leafTaskRef: value.leafTaskRef,
    repoRef: value.repository.repoRef,
    baseHead: value.repository.baseHead,
    frozenScopeDigest: value.frozenScopeDigest
  }) : deriveTaskToPrIdentityDigest({
    canonicalizationVersion: 2,
    rootRequestRef: value.rootRequestRef,
    prGroupRef: value.prGroupRef,
    leafTaskRef: value.leafTaskRef,
    repoRef: value.repository.repoRef,
    worktreeRef: value.repository.worktreeRef,
    branchRef: value.repository.branchRef,
    baseHead: value.repository.baseHead,
    frozenScopeDigest: value.frozenScopeDigest
  });
  if (value.identityDigest !== derivedIdentityDigest) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "identityDigest must equal the selected v1 compatibility or v2 branch/worktree-bound canonical identity digest",
      path: ["identityDigest"]
    });
  }
  const provenanceIds = new Set;
  const provenanceDigests = new Set;
  const provenanceProjectionIds = new Set;
  const provenanceAttemptNonces = new Set;
  const provenanceReplayPrefixes = new Set;
  const provenanceReplaySequences = new Set;
  for (const [index, entry] of value.provenanceLedger.entries()) {
    if ("ref" in entry) {
      if (provenanceIds.has(entry.ref.id)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Provenance entries cannot reuse a canonical owner id across categories or generations",
          path: ["provenanceLedger", index, "ref", "id"]
        });
      }
      provenanceIds.add(entry.ref.id);
      if (provenanceDigests.has(entry.ref.digest)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Provenance entries cannot reuse a canonical digest across categories or generations",
          path: ["provenanceLedger", index, "ref", "digest"]
        });
      }
      provenanceDigests.add(entry.ref.digest);
      continue;
    }
    if (entry.category === "projection_id") {
      if (provenanceProjectionIds.has(entry.projectionId)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Projection identity provenance tombstones must be globally unique",
          path: ["provenanceLedger", index, "projectionId"]
        });
      }
      provenanceProjectionIds.add(entry.projectionId);
      continue;
    }
    if (entry.category === "attempt_nonce") {
      if (provenanceAttemptNonces.has(entry.nonce)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Attempt nonce provenance tombstones must be globally unique",
          path: ["provenanceLedger", index, "nonce"]
        });
      }
      provenanceAttemptNonces.add(entry.nonce);
      continue;
    }
    if (provenanceReplayPrefixes.has(entry.prefixDigest)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Replay prefix provenance tombstones must be globally unique",
        path: ["provenanceLedger", index, "prefixDigest"]
      });
    }
    provenanceReplayPrefixes.add(entry.prefixDigest);
    if (provenanceReplaySequences.has(entry.sequence)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Replay prefix provenance entries must bind globally unique replay sequences",
        path: ["provenanceLedger", index, "sequence"]
      });
    }
    provenanceReplaySequences.add(entry.sequence);
  }
  for (const activeEntry of taskToPrActiveProvenanceEntries(value)) {
    if (!value.provenanceLedger.some((entry) => sameTaskToPrProvenanceEntry(entry, activeEntry))) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `The active ${activeEntry.category} identity must be represented exactly in the monotonic provenance ledger`,
        path: ["provenanceLedger"]
      });
    }
  }
  const requiredCanonicalPreservationRefs = [
    value.rootRequestRef,
    value.prGroupRef,
    value.leafTaskRef,
    value.repository.repoRef,
    value.repository.worktreeRef,
    value.repository.branchRef,
    value.events.streamRef,
    ...value.pullRequestRef ? [value.pullRequestRef] : []
  ];
  const requirePreservedRefs = (preservedStateRefs, requiredRefs, path, label) => {
    const requiredRoles = new Set(requiredRefs.map((requiredRef) => requiredRef.role));
    const seenRoles = new Set;
    for (const [index, preservedRef] of preservedStateRefs.entries()) {
      if (!requiredRoles.has(preservedRef.role)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: `${label} cannot preserve an unrecognized ${preservedRef.role} role`,
          path: [...path, index]
        });
      }
      if (seenRoles.has(preservedRef.role)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: `${label} must preserve exactly one canonical ref per role`,
          path: [...path, index]
        });
      }
      seenRoles.add(preservedRef.role);
    }
    if (preservedStateRefs.length !== requiredRefs.length) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `${label} preservation refs must exactly equal the required canonical role set`,
        path
      });
    }
    for (const requiredRef of requiredRefs) {
      if (!preservedStateRefs.some((preservedRef) => sameTaskToPrRef(preservedRef, requiredRef))) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: `${label} must preserve ${requiredRef.role}`,
          path
        });
      }
    }
  };
  if (value.handoff && !sameTaskToPrRef(value.handoff.nextWriterGenerationRef, value.attempt.writerGenerationRef)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Handoff next generation must be the current attempt writer generation",
      path: ["handoff", "nextWriterGenerationRef"]
    });
  }
  if (value.handoff && !sameTaskToPrRef(value.handoff.nextAttemptRef, value.attempt.ref)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Handoff next attempt must be the current attempt",
      path: ["handoff", "nextAttemptRef"]
    });
  }
  if (value.handoff) {
    requireFreshTaskToPrRef(value.handoff.stoppedWorkRunRef, value.workRunRef, ctx, ["handoff", "stoppedWorkRunRef"], "Handoff WorkRun rotation");
  }
  if (value.recovery) {
    if (value.recovery.successorAttemptNonce !== value.attempt.nonce) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Recovery successor nonce must equal the current attempt nonce",
        path: ["recovery", "successorAttemptNonce"]
      });
    }
    if (!sameTaskToPrRef(value.recovery.successorWriterGenerationRef, value.attempt.writerGenerationRef)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Recovery successor generation must equal the current writer generation",
        path: ["recovery", "successorWriterGenerationRef"]
      });
    }
    requireFreshTaskToPrRef(value.recovery.priorAttemptRef, value.attempt.ref, ctx, ["recovery", "priorAttemptRef"], "Recovery attempt rotation");
    requireFreshTaskToPrRef(value.recovery.priorWorkRunRef, value.workRunRef, ctx, ["recovery", "priorWorkRunRef"], "Recovery WorkRun rotation");
    requirePreservedRefs(value.recovery.preservedStateRefs, [value.recovery.priorWorkRunRef, ...requiredCanonicalPreservationRefs], ["recovery", "preservedStateRefs"], "Recovery");
  }
  if (value.cancellation && !sameTaskToPrRef(value.cancellation.cancelledAttemptRef, value.attempt.ref)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Cancellation must bind the current attempt",
      path: ["cancellation", "cancelledAttemptRef"]
    });
  }
  if (value.cancellation) {
    requirePreservedRefs(value.cancellation.preservedStateRefs, [value.workRunRef, value.attempt.ref, ...requiredCanonicalPreservationRefs], ["cancellation", "preservedStateRefs"], "Cancellation");
  }
  if (value.cancellation && value.recovery) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "A projection cannot be both the cancellation and recovery snapshot",
      path: ["recovery"]
    });
  }
  if (value.handoff && value.recovery) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "A projection cannot be both the handoff and recovery snapshot",
      path: ["recovery"]
    });
  }
  if (value.cleanup && !sameTaskToPrRef(value.cleanup.eligibility.eventCursorRef, value.events.replayCursorRef)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Cleanup eligibility must bind the current canonical replay cursor",
      path: ["cleanup", "eligibility", "eventCursorRef"]
    });
  }
  if (value.cleanup && (!value.terminalDispositionRef || !sameTaskToPrRef(value.cleanup.eligibility.terminalDispositionRef, value.terminalDispositionRef))) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Cleanup eligibility must bind the exact durable terminal owner fact",
      path: ["cleanup", "eligibility", "terminalDispositionRef"]
    });
  }
  if (value.cleanup && !sameTaskToPrRef(value.cleanup.eligibility.writerLeaseRef, value.attempt.writerLeaseRef)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Cleanup eligibility must bind the exact writer lease being revoked",
      path: ["cleanup", "eligibility", "writerLeaseRef"]
    });
  }
  if (value.cleanup && !sameTaskToPrRef(value.cleanup.eligibility.targetWorktreeRef, value.repository.worktreeRef)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Cleanup eligibility must bind the canonical worktree",
      path: ["cleanup", "eligibility", "targetWorktreeRef"]
    });
  }
  if (value.pullRequestRef) {
    if (value.exactHead && !sameTaskToPrRef(value.exactHead.pullRequestRef, value.pullRequestRef)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Exact-head proof must bind the canonical pull request ref",
        path: ["exactHead", "pullRequestRef"]
      });
    }
    for (const [reviewIndex, review] of value.reviews.entries()) {
      if (!sameTaskToPrRef(review.pullRequestRef, value.pullRequestRef)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Every review must bind the canonical pull request ref",
          path: ["reviews", reviewIndex, "pullRequestRef"]
        });
      }
    }
    if (value.merge && !sameTaskToPrRef(value.merge.guard.pullRequestRef, value.pullRequestRef)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Merge guard must bind the canonical pull request ref",
        path: ["merge", "guard", "pullRequestRef"]
      });
    }
    if (value.merge?.outcome && !sameTaskToPrRef(value.merge.outcome.pullRequestRef, value.pullRequestRef)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Merge outcome must bind the canonical pull request ref",
        path: ["merge", "outcome", "pullRequestRef"]
      });
    }
  } else if (value.exactHead || value.reviews.length > 0 || value.merge) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Review and merge state require a canonical pull request ref",
      path: ["pullRequestRef"]
    });
  }
  if (value.exactHead && !sameGitObjectId(value.exactHead.localHead, value.repository.branchHead)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Exact local head must equal the canonical branch head",
      path: ["exactHead", "localHead"]
    });
  }
  if (value.exactHead && !sameGitObjectId(value.exactHead.expectedBase, value.repository.baseHead)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Exact-head expected base must equal the canonical repository base",
      path: ["exactHead", "expectedBase"]
    });
  }
  if (value.exactHead && !sameTaskToPrRef(value.exactHead.remoteBranchRef, value.repository.branchRef)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Exact-head remote branch ref must equal the canonical repository branch ref",
      path: ["exactHead", "remoteBranchRef"]
    });
  }
  if (value.exactHead && Date.parse(value.exactHead.verifiedAt) < Date.parse(value.createdAt)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Exact-head verification cannot precede the projection timestamp",
      path: ["exactHead", "verifiedAt"]
    });
  }
  if (value.reviews.length > 0 && !value.exactHead) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Reviews require local/remote/provider exact-head proof",
      path: ["exactHead"]
    });
  }
  if (value.exactHead) {
    const proofObligations = [
      { ref: value.exactHead.equalityProofRef, path: ["exactHead", "equalityProofRef"] },
      ...value.exactHead.ciProofBundleRefs.map((ref, index) => ({
        ref,
        path: ["exactHead", "ciProofBundleRefs", index]
      })),
      ...value.reviews.map((review, index) => ({
        ref: review.proofBundleRef,
        path: ["reviews", index, "proofBundleRef"]
      }))
    ];
    const proofObligationKeys = new Set;
    const proofObligationDigests = new Set;
    for (const obligation of proofObligations) {
      const key = taskToPrCanonicalRefKey(obligation.ref);
      if (proofObligationKeys.has(key)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Exact-head equality, CI, and review proof obligations require globally unique canonical identities",
          path: obligation.path
        });
      }
      proofObligationKeys.add(key);
      if (proofObligationDigests.has(obligation.ref.digest)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Exact-head equality, CI, and review proof obligations require globally unique canonical digests",
          path: obligation.path
        });
      }
      proofObligationDigests.add(obligation.ref.digest);
    }
  }
  const reviewKeys = new Set;
  const reviewDigests = new Set;
  const reviewerKeys = new Set;
  const reviewerDigests = new Set;
  const reviewRunKeys = new Set;
  const reviewRunDigests = new Set;
  const reviewProofKeys = new Set;
  const reviewProofDigests = new Set;
  for (const [reviewIndex, review] of value.reviews.entries()) {
    if (!sameGitObjectId(review.base, value.repository.baseHead)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Review base must equal the exact canonical pull-request base",
        path: ["reviews", reviewIndex, "base"]
      });
    }
    if (!sameGitObjectId(review.head, value.repository.branchHead)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Review head must equal the exact canonical branch head",
        path: ["reviews", reviewIndex, "head"]
      });
    }
    for (const [key, seen, path] of [
      [review.ref.id, reviewKeys, "ref"],
      [review.reviewerRef.id, reviewerKeys, "reviewerRef"],
      [review.reviewRunRef.id, reviewRunKeys, "reviewRunRef"]
    ]) {
      if (seen.has(key)) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Review, reviewer, and review-run refs must each be unique",
          path: ["reviews", reviewIndex, path]
        });
      }
      seen.add(key);
    }
    if (reviewDigests.has(review.ref.digest)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Review refs must resolve to distinct canonical record digests",
        path: ["reviews", reviewIndex, "ref"]
      });
    }
    reviewDigests.add(review.ref.digest);
    if (reviewerDigests.has(review.reviewerRef.digest)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Reviewer refs must resolve to distinct canonical actor digests",
        path: ["reviews", reviewIndex, "reviewerRef"]
      });
    }
    reviewerDigests.add(review.reviewerRef.digest);
    if (reviewRunDigests.has(review.reviewRunRef.digest)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Review-run refs must resolve to distinct canonical run digests",
        path: ["reviews", reviewIndex, "reviewRunRef"]
      });
    }
    reviewRunDigests.add(review.reviewRunRef.digest);
    const reviewProofKey = taskToPrCanonicalRefKey(review.proofBundleRef);
    if (reviewProofKeys.has(reviewProofKey)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Review proof bundles must have unique canonical identities",
        path: ["reviews", reviewIndex, "proofBundleRef"]
      });
    }
    reviewProofKeys.add(reviewProofKey);
    if (reviewProofDigests.has(review.proofBundleRef.digest)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Review proof bundles must have unique canonical digests",
        path: ["reviews", reviewIndex, "proofBundleRef"]
      });
    }
    reviewProofDigests.add(review.proofBundleRef.digest);
    if (review.reviewerRef.digest === value.attempt.workerRef.digest) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Worker and reviewer identities must resolve to distinct canonical digests",
        path: ["reviews", reviewIndex, "reviewerRef"]
      });
    }
    if (review.reviewRunRef.digest === value.attempt.runtimeRef.digest) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Worker runtime and review run must resolve to distinct canonical digests",
        path: ["reviews", reviewIndex, "reviewRunRef"]
      });
    }
    if (value.exactHead && Date.parse(review.reviewedAt) < Date.parse(value.exactHead.verifiedAt)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Reviews cannot precede exact-head verification",
        path: ["reviews", reviewIndex, "reviewedAt"]
      });
    }
  }
  if (value.merge) {
    if (!value.exactHead) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Merge state requires local/remote/provider exact-head proof",
        path: ["exactHead"]
      });
    }
    if (!sameGitObjectId(value.merge.guard.expectedBase, value.repository.baseHead)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Merge guard expected base must equal the exact canonical pull-request base",
        path: ["merge", "guard", "expectedBase"]
      });
    }
    if (!sameGitObjectId(value.merge.guard.expectedHead, value.repository.branchHead)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Merge guard expected head must equal the exact canonical branch head",
        path: ["merge", "guard", "expectedHead"]
      });
    }
    if (value.exactHead && Date.parse(value.merge.guard.evaluatedAt) < Date.parse(value.exactHead.verifiedAt)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Merge guards cannot precede exact-head verification",
        path: ["merge", "guard", "evaluatedAt"]
      });
    }
    if (value.reviews.some((review) => Date.parse(value.merge.guard.evaluatedAt) < Date.parse(review.reviewedAt))) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Merge guards cannot precede their bound reviews",
        path: ["merge", "guard", "evaluatedAt"]
      });
    }
    if (value.merge.guard.operatorRef.digest === value.attempt.workerRef.digest) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Worker and merge operator identities must resolve to distinct canonical digests",
        path: ["merge", "guard", "operatorRef"]
      });
    }
    if (value.merge.guard.operatorRunRef.digest === value.attempt.runtimeRef.digest) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Worker runtime and merge-operator run must resolve to distinct canonical digests",
        path: ["merge", "guard", "operatorRunRef"]
      });
    }
    for (const [reviewIndex, review] of value.reviews.entries()) {
      if (value.merge.guard.operatorRef.digest === review.reviewerRef.digest) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Reviewer and merge operator identities must resolve to distinct canonical digests",
          path: ["reviews", reviewIndex, "reviewerRef"]
        });
      }
      if (value.merge.guard.operatorRunRef.digest === review.reviewRunRef.digest) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Review and merge-operator runs must resolve to distinct canonical digests",
          path: ["reviews", reviewIndex, "reviewRunRef"]
        });
      }
    }
    if (value.merge.guard.decision === "eligible" || value.merge.guard.decision === "consumed") {
      if (value.reviews.length === 0 || value.reviews.some((review) => review.verdict !== "approved")) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Eligible merge guards require at least one review and all reviews approved",
          path: ["merge", "guard", "decision"]
        });
      }
      if (value.merge.guard.reviewRefs.length !== value.reviews.length || value.merge.guard.reviewRefs.some((reviewRef) => !value.reviews.some((review) => sameTaskToPrRef(reviewRef, review.ref)))) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Eligible merge guard review refs must exactly equal the projected approved review refs as a canonical set",
          path: ["merge", "guard", "reviewRefs"]
        });
      }
      for (const review of value.reviews) {
        if (!value.merge.guard.proofBundleRefs.some((proofRef) => sameTaskToPrRef(proofRef, review.proofBundleRef))) {
          ctx.addIssue({
            code: exports_external.ZodIssueCode.custom,
            message: "Eligible merge guards must bind every exact review proof bundle",
            path: ["merge", "guard", "proofBundleRefs"]
          });
        }
      }
      if (value.exactHead && !value.merge.guard.proofBundleRefs.some((proofRef) => sameTaskToPrRef(proofRef, value.exactHead.equalityProofRef))) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Eligible merge guards must bind the exact-head equality proof",
          path: ["merge", "guard", "proofBundleRefs"]
        });
      }
      if (value.exactHead && value.exactHead.ciProofBundleRefs.some((ciProofRef) => !value.merge.guard.proofBundleRefs.some((proofRef) => sameTaskToPrRef(proofRef, ciProofRef)))) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "Eligible merge guards must bind every exact-head CI proof",
          path: ["merge", "guard", "proofBundleRefs"]
        });
      }
    }
  }
  if (value.merge?.outcome) {
    if (!sameTaskToPrRef(value.merge.outcome.guardRef, value.merge.guard.ref)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Merge outcome must bind the exact immutable merge guard",
        path: ["merge", "outcome", "guardRef"]
      });
    }
    if (!sameGitObjectId(value.merge.outcome.expectedHead, value.merge.guard.expectedHead)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Merge outcome expected head must equal the guarded expected head",
        path: ["merge", "outcome", "expectedHead"]
      });
    }
    if (!sameGitObjectId(value.merge.outcome.expectedBase, value.merge.guard.expectedBase)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Merge outcome expected base must equal the guarded expected base",
        path: ["merge", "outcome", "expectedBase"]
      });
    }
    if (value.merge.guard.decision !== "consumed") {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Every merge outcome requires an explicitly consumed merge guard",
        path: ["merge", "guard", "decision"]
      });
    }
    if (Date.parse(value.merge.outcome.finishedAt) < Date.parse(value.merge.guard.evaluatedAt)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Merge outcomes cannot precede guard evaluation",
        path: ["merge", "outcome", "finishedAt"]
      });
    }
  }
  if (value.cleanup) {
    const cleanupFloor = value.merge?.outcome?.finishedAt ?? value.createdAt;
    if (Date.parse(value.cleanup.eligibility.evaluatedAt) < Date.parse(cleanupFloor)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Cleanup eligibility cannot precede the terminal merge outcome or projection",
        path: ["cleanup", "eligibility", "evaluatedAt"]
      });
    }
    if (value.cleanup.outcome && Date.parse(value.cleanup.outcome.finishedAt) < Date.parse(value.cleanup.eligibility.evaluatedAt)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Cleanup outcomes cannot precede cleanup eligibility",
        path: ["cleanup", "outcome", "finishedAt"]
      });
    }
  }
  if (value.rollback?.outcome && value.merge?.outcome && Date.parse(value.rollback.outcome.finishedAt) < Date.parse(value.merge.outcome.finishedAt)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Rollback outcomes cannot precede the merge outcome they remediate",
      path: ["rollback", "outcome", "finishedAt"]
    });
  }
  if (value.rollback) {
    const rollbackFloor = value.merge?.outcome?.finishedAt ?? value.createdAt;
    if (Date.parse(value.rollback.plan.createdAt) < Date.parse(rollbackFloor)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Rollback plans cannot precede the terminal merge outcome or projection",
        path: ["rollback", "plan", "createdAt"]
      });
    }
  }
  if (value.state === "handed_off" && !value.handoff) {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Handed-off projections require a handoff ref", path: ["handoff"] });
  }
  if (TaskToPrStatesWithoutReviewAuthority.has(value.state) && value.reviews.length > 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: `${value.state} projections cannot carry review bindings before review authority is active`,
      path: ["reviews"]
    });
  }
  if ((TaskToPrStatesWithoutReviewAuthority.has(value.state) || value.state === "recovering") && (value.merge?.guard.reviewRefs.length ?? 0) > 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: `${value.state} projections cannot hide review bindings in a merge guard before review authority is active`,
      path: ["merge", "guard", "reviewRefs"]
    });
  }
  const mergeMatrixKey = value.merge ? `${value.merge.guard.decision}:${value.merge.outcome?.status ?? "none"}` : "absent";
  if (!TASK_TO_PR_STATE_MERGE_MATRIX[value.state].has(mergeMatrixKey)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: `State ${value.state} is incompatible with merge authority ${mergeMatrixKey}`,
      path: ["merge"]
    });
  }
  if (TaskToPrTerminalStates.has(value.state) && !value.terminalDispositionRef) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: `${value.state} projections require a durable Todos terminal-disposition owner ref`,
      path: ["terminalDispositionRef"]
    });
  }
  if (!TaskToPrTerminalStates.has(value.state) && value.terminalDispositionRef) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: `${value.state} projections cannot carry a terminal-disposition owner ref`,
      path: ["terminalDispositionRef"]
    });
  }
  if (value.state === "reviewing" && value.reviews.length === 0) {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Reviewing projections require review refs", path: ["reviews"] });
  }
  if (value.state === "cancelled" && !value.cancellation) {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Cancelled projections require preservation state", path: ["cancellation"] });
  }
  if (value.cancellation && value.merge?.outcome) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Cancellation cannot coexist with a terminal merge outcome",
      path: ["cancellation"]
    });
  }
  if (value.state === "recovering" && !value.recovery) {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Recovering projections require recovery state", path: ["recovery"] });
  }
  if (value.state === "repairing" && value.repair.cycle === 0) {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Repairing projections require a non-zero repair cycle", path: ["repair", "cycle"] });
  }
  if (value.merge && (value.merge.guard.decision === "eligible" || value.merge.guard.decision === "consumed") && !sameTaskToPrRef(value.attempt.admissionWriterGenerationRef, value.attempt.writerGenerationRef)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Merge eligibility requires admission from the current writer generation",
      path: ["attempt", "admissionWriterGenerationRef"]
    });
  }
  if (value.state === "merge_ready" && value.merge?.guard.decision !== "eligible") {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Merge-ready projections require an eligible guard", path: ["merge"] });
  }
  if (value.state === "merged" && value.merge?.outcome?.status !== "merged") {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Merged projections require a merged immutable outcome", path: ["merge"] });
  }
  if (value.state === "closed_unmerged" && !value.merge?.outcome?.status.match(/^(closed_unmerged|refused|head_drift|base_drift)$/)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Closed-unmerged projections require a non-merged terminal outcome",
      path: ["merge"]
    });
  }
  if (value.state === "cleanup_complete" && (!value.cleanup?.outcome || !["deleted", "preserved", "skipped"].includes(value.cleanup.outcome.status))) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Cleanup-complete projections require an immutable cleanup outcome",
      path: ["cleanup"]
    });
  }
  if (value.state === "rolled_back" && value.rollback?.outcome?.status !== "succeeded") {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Rolled-back projections require a successful rollback outcome",
      path: ["rollback"]
    });
  }
  if ((value.state === "failed" || value.state === "blocked") && value.evidenceRefs.length === 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Failed and blocked projections require redacted evidence refs",
      path: ["evidenceRefs"]
    });
  }
  if (["admitted", "running", "handed_off", "reviewing", "repairing", "merge_ready", "recovering"].includes(value.state) && (value.merge?.outcome || value.cancellation || value.cleanup?.outcome || value.rollback?.outcome)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Non-terminal projections cannot carry terminal owner outcomes",
      path: ["state"]
    });
  }
  const extensionKeys = new Set;
  for (const [index, extension] of value.adapterExtensions.entries()) {
    const key = `${extension.schema}:${extension.ref.id}`;
    if (extensionKeys.has(key)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Adapter extensions must be unique per schema and referenced object",
        path: ["adapterExtensions", index]
      });
    }
    extensionKeys.add(key);
  }
});
var TrajectoryEventSchema = exports_external.object({
  id: exports_external.string().min(1),
  at: TimestampSchema,
  kind: exports_external.enum(["message", "tool_call", "command", "file_change", "error", "test", "decision", "verification", "status", "other"]),
  summary: exports_external.string().min(1),
  resourceRefs: exports_external.array(ResourcePointerSchema).default([]),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([]),
  costEstimate: CostEstimateSchema.optional()
}).strict();
var AgentTrajectorySchema = contractBaseSchema(SCHEMA_IDS.agentTrajectory).extend({
  actor: ActorPointerSchema,
  workRunRef: ResourcePointerSchema.optional(),
  events: exports_external.array(TrajectoryEventSchema).default([]),
  outcome: exports_external.enum(["succeeded", "failed", "cancelled", "blocked", "unknown"]).default("unknown"),
  proofBundleRef: ResourcePointerSchema.optional()
}).strict();
var SERVICE_CONTRACT_VERSION = "v1";
var RepoClassSchema = exports_external.enum(["library", "cli-with-store", "service", "saas"]);
var HOSTING_MODES = ["user-hosted", "hasna-saas"];
var HostingModeSchema = exports_external.enum(HOSTING_MODES);
var SERVICE_SURFACE_KINDS = ["api", "sdk", "mcp", "cli"];
var ServiceSurfaceKindSchema = exports_external.enum(SERVICE_SURFACE_KINDS);
var ServiceSurfaceStatusSchema = exports_external.enum(["supported", "deferred", "unsupported"]);
var ServiceAuthModeSchema = exports_external.enum(["none", "local-only", "api-key", "session", "service-token", "custom"]);
var ServiceEndpointSchema = exports_external.object({
  method: exports_external.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: exports_external.string().regex(/^\/[A-Za-z0-9_./:*-]*$/, "Endpoint paths must be absolute HTTP paths"),
  public: exports_external.boolean().default(false),
  description: exports_external.string().min(1).optional()
}).strict();
var DeploymentReadinessGateSchema = exports_external.object({
  id: exports_external.string().min(1),
  kind: exports_external.enum(["auth", "storage", "secret-ref", "migration", "health", "readiness", "redaction", "smoke", "operator", "other"]),
  required: exports_external.boolean().default(true),
  command: exports_external.string().min(1).optional(),
  evidenceRef: EvidencePointerSchema.optional(),
  status: exports_external.enum(["pending", "passed", "failed", "blocked", "deferred"]).default("pending"),
  summary: exports_external.string().min(1).optional()
}).strict().superRefine((value, ctx) => {
  if ((value.status === "passed" || value.status === "failed" || value.status === "blocked") && !value.command && !value.evidenceRef && !value.summary) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Terminal readiness gates require command, evidenceRef, or summary",
      path: ["status"]
    });
  }
});
var ServiceSurfaceSchema = exports_external.object({
  name: exports_external.string().min(1),
  kind: ServiceSurfaceKindSchema.optional(),
  status: ServiceSurfaceStatusSchema,
  bin: exports_external.string().min(1).optional(),
  mcpBin: exports_external.string().min(1).optional(),
  authMode: ServiceAuthModeSchema,
  health: ServiceEndpointSchema.optional(),
  readiness: ServiceEndpointSchema.optional(),
  version: ServiceEndpointSchema.optional(),
  apiBasePath: exports_external.string().regex(/^\/v[0-9]+$/, "Stable API base path must be /vN").optional(),
  openApiPath: exports_external.string().regex(/^\/[A-Za-z0-9_./:-]*$/).optional(),
  exportSubpath: exports_external.string().regex(/^\.(?:\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)?$/, "SDK export subpaths must be package export keys such as . or ./sdk").optional(),
  generatedFrom: exports_external.string().regex(/^\/[A-Za-z0-9_./:-]*$/, "SDK generatedFrom must reference an absolute OpenAPI path").optional(),
  clientClassName: exports_external.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/).optional(),
  deferReason: exports_external.string().min(1).optional(),
  readinessGates: exports_external.array(DeploymentReadinessGateSchema).default([])
}).strict().superRefine((value, ctx) => {
  if (value.status === "supported") {
    if (!value.kind || value.kind === "api") {
      if (!value.bin) {
        ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Supported API surfaces require a serve bin", path: ["bin"] });
      }
      if (!value.health) {
        ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Supported API surfaces require a health endpoint", path: ["health"] });
      }
      if (!value.readiness) {
        ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Supported API surfaces require a readiness endpoint", path: ["readiness"] });
      }
      if (!value.version) {
        ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Supported API surfaces require a version endpoint", path: ["version"] });
      }
    }
    if (value.kind === "cli" && !value.bin) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Supported CLI surfaces require a bin", path: ["bin"] });
    }
    if (value.kind === "mcp" && !value.mcpBin) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Supported MCP surfaces require an mcpBin", path: ["mcpBin"] });
    }
    if (value.kind === "sdk" && !value.exportSubpath) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Supported SDK surfaces require an exportSubpath", path: ["exportSubpath"] });
    }
  }
  if ((value.status === "deferred" || value.status === "unsupported") && !value.deferReason) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Deferred or unsupported service surfaces require a deferReason",
      path: ["deferReason"]
    });
  }
  if (value.health && value.health.path !== "/health") {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Health endpoint must be /health", path: ["health", "path"] });
  }
  if (value.health && value.health.method !== "GET") {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Health endpoint must use GET", path: ["health", "method"] });
  }
  if (value.readiness && value.readiness.path !== "/ready") {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Readiness endpoint must be /ready", path: ["readiness", "path"] });
  }
  if (value.readiness && value.readiness.method !== "GET") {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Readiness endpoint must use GET", path: ["readiness", "method"] });
  }
  if (value.version && value.version.path !== "/version") {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Version endpoint must be /version", path: ["version", "path"] });
  }
  if (value.version && value.version.method !== "GET") {
    ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Version endpoint must use GET", path: ["version", "method"] });
  }
});
var ServerDataBackendSchema = exports_external.literal("postgresql");
var STORAGE_ENGINES = ["sqlite", "postgresql"];
var STORAGE_ENGINE_VALUES = ["sqlite", "json", "postgresql"];
var LOCAL_STORAGE_ENGINES = ["sqlite", "json"];
var StorageEngineSchema = exports_external.enum(STORAGE_ENGINE_VALUES);
var WAIVABLE_STORAGE_ENGINES = ["postgresql"];
var SurfaceConformanceWaiverSchema = exports_external.object({
  kind: ServiceSurfaceKindSchema,
  reason: exports_external.string().trim().min(1)
}).strict();
var STORAGE_WAIVER_REASON_MAX_LENGTH = 500;
var STORAGE_WAIVER_REVIEWER_MAX_LENGTH = 200;
var WaiverTextSchema = (maxLength) => exports_external.string().trim().min(1).max(maxLength).regex(/^[^\u0000-\u001f\u007f]+$/, "Waiver text must not contain control characters");
var ASSET_INVENTORY_KINDS = ["domain", "host", "ip", "email"];
var AssetInventoryWaiverSchema = exports_external.object({
  kind: exports_external.enum(ASSET_INVENTORY_KINDS),
  reason: WaiverTextSchema(STORAGE_WAIVER_REASON_MAX_LENGTH),
  reviewedBy: WaiverTextSchema(STORAGE_WAIVER_REVIEWER_MAX_LENGTH),
  expiresAt: TimestampSchema
}).strict();
var StorageEngineWaiverSchema = exports_external.object({
  engine: exports_external.enum(WAIVABLE_STORAGE_ENGINES),
  reason: WaiverTextSchema(STORAGE_WAIVER_REASON_MAX_LENGTH),
  reviewedBy: WaiverTextSchema(STORAGE_WAIVER_REVIEWER_MAX_LENGTH).optional(),
  expiresAt: TimestampSchema.optional()
}).strict();
function declaresSupportedApiSurface(surfaces) {
  return surfaces.some((surface) => surface.status === "supported" && (surface.kind === "api" || !surface.kind && Boolean(surface.apiBasePath || surface.openApiPath || surface.health || surface.readiness || surface.version)));
}
function storageWaiverIneligibilityReason(input) {
  if (input.class !== "cli-with-store") {
    return `storage waivers are not permitted for class ${input.class}`;
  }
  if (input.bins.includes(`${input.name}-serve`)) {
    return `storage waivers are not permitted for a service-capable cli-with-store repo shipping ${input.name}-serve`;
  }
  if (declaresSupportedApiSurface(input.serviceSurfaces ?? [])) {
    return "storage waivers are not permitted for a service-capable cli-with-store repo declaring a supported api service surface";
  }
  if (input.storageBackend === "postgresql") {
    return "storage waivers are not permitted while storage.backend is postgresql, which reads and writes PostgreSQL directly";
  }
  if (input.hosting.includes("hasna-saas")) {
    return "storage waivers are not permitted for a repo declaring the hasna-saas product story";
  }
  return null;
}
var ServiceContractMetadataSchema = exports_external.object({
  conformance: exports_external.object({
    waivedSurfaces: exports_external.array(SurfaceConformanceWaiverSchema).default([]),
    waiverProfile: exports_external.literal("non-node-monorepo").optional(),
    waivedStorageEngines: exports_external.array(StorageEngineWaiverSchema).default([]),
    waivedAssetInventories: exports_external.array(AssetInventoryWaiverSchema).default([])
  }).catchall(exports_external.unknown()).optional(),
  release: exports_external.object({
    artifactScan: exports_external.object({
      script: exports_external.string().trim().min(1)
    }).strict().optional()
  }).catchall(exports_external.unknown()).optional()
}).catchall(exports_external.unknown());
var AppNameSchema = exports_external.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "App names must be lowercase dashed identifiers");
var ALLOWED_BIN_SUFFIXES = [
  "",
  "-cli",
  "-mcp",
  "-serve",
  "-worker",
  "-runner",
  "-daemon",
  "-migrate",
  "-doctor"
];
var CANONICAL_HASNA_BIN_ALIASES = Object.freeze({
  deployment: Object.freeze(["hasna-deploy"])
});
function allowedBinsForName(name) {
  return [
    ...ALLOWED_BIN_SUFFIXES.map((suffix) => `${name}${suffix}`),
    ...CANONICAL_HASNA_BIN_ALIASES[name] ?? []
  ];
}
function databaseUrlSecretRefFor(name) {
  return `hasna/oss/${name}/database-url`;
}
var StorageContractSchema = exports_external.object({
  backend: exports_external.enum(["sqlite", "postgresql"]),
  engines: exports_external.array(StorageEngineSchema).min(1).optional(),
  envPrefix: exports_external.string().regex(/^HASNA_[A-Z][A-Z0-9]*_$/).optional(),
  aliasEnvPrefix: exports_external.string().regex(/^[A-Z][A-Z0-9]*_$/).optional(),
  databaseUrlSecretRef: exports_external.string().regex(/^hasna\/oss\/[a-z0-9-]+\/database-url$/).optional(),
  sqlitePath: exports_external.string().min(1).endsWith(".db", "storage.sqlitePath must end in .db").optional(),
  pgTestGate: exports_external.object({
    envVar: exports_external.string().regex(/^[A-Z][A-Z0-9_]*_TEST_DATABASE_URL$/),
    command: exports_external.string().trim().min(1)
  }).strict().optional()
}).strict().superRefine((value, ctx) => {
  if (value.engines && new Set(value.engines).size !== value.engines.length) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "storage.engines must not contain duplicates",
      path: ["engines"]
    });
  }
  if (value.engines?.includes("postgresql") && !value.envPrefix) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "storage.engines containing postgresql requires envPrefix for the HASNA_<NAME>_DATABASE_URL contract",
      path: ["envPrefix"]
    });
  }
});
var OwnerOnlyFileModeSchema = exports_external.enum(["0600"]);
var OwnerOnlyDirectoryModeSchema = exports_external.enum(["0700"]);
var LocalStoreRootSchema = exports_external.enum([".hasna", ".codewith"]);
var SecureLocalStoreArtifactClassSchema = exports_external.enum([
  "directory",
  "file",
  "sqlite_db",
  "sqlite_wal",
  "sqlite_shm",
  "backup",
  "export",
  "report",
  "tmp",
  "log",
  "session",
  "snapshot"
]);
var SecureLocalStorePathPatternSchema = RelativeProjectPathSchema.refine((value) => !value.startsWith("~"), "Local store path patterns must be relative to their declared root");
var SecureLocalStoreActiveRecordExclusionSchema = exports_external.object({
  id: exports_external.string().min(1),
  source: exports_external.enum(["sqlite", "manifest", "index", "runtime", "package_adapter"]),
  table: exports_external.string().min(1).optional(),
  column: exports_external.string().min(1).optional(),
  description: exports_external.string().min(1),
  required: exports_external.boolean().default(true)
}).strict();
var SecureLocalStoreSqliteMaintenanceSchema = exports_external.object({
  safeWhen: exports_external.enum(["exclusive_access", "offline_only", "never"]),
  operations: exports_external.array(exports_external.enum(["wal_checkpoint_truncate", "incremental_vacuum", "optimize", "vacuum"])).default([])
}).strict().superRefine((value, ctx) => {
  if (value.safeWhen === "never" && value.operations.length > 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "sqliteMaintenance.safeWhen=never cannot declare operations",
      path: ["operations"]
    });
  }
});
var SecureLocalStoreRetentionAdapterSchema = exports_external.object({
  id: exports_external.string().min(1),
  description: exports_external.string().min(1),
  ttlDays: exports_external.number().int().nonnegative().optional(),
  artifactClasses: exports_external.array(SecureLocalStoreArtifactClassSchema).min(1),
  allowlistGlobs: exports_external.array(SecureLocalStorePathPatternSchema).min(1),
  activeRecordExclusions: exports_external.array(SecureLocalStoreActiveRecordExclusionSchema).default([]),
  sqliteMaintenance: SecureLocalStoreSqliteMaintenanceSchema.optional()
}).strict();
var SecureLocalStoreDefinitionSchema = exports_external.object({
  storeId: exports_external.string().regex(/^[a-z][a-z0-9-]*$/),
  packageName: exports_external.string().min(1),
  displayName: exports_external.string().min(1),
  root: LocalStoreRootSchema,
  relativePath: SecureLocalStorePathPatternSchema,
  directoryMode: OwnerOnlyDirectoryModeSchema.default("0700"),
  fileMode: OwnerOnlyFileModeSchema.default("0600"),
  sqliteDatabaseGlobs: exports_external.array(SecureLocalStorePathPatternSchema).default([]),
  sensitiveFileGlobs: exports_external.array(SecureLocalStorePathPatternSchema).default([]),
  backupGlobs: exports_external.array(SecureLocalStorePathPatternSchema).default([]),
  exportGlobs: exports_external.array(SecureLocalStorePathPatternSchema).default([]),
  retentionAdapters: exports_external.array(SecureLocalStoreRetentionAdapterSchema).default([]),
  notes: exports_external.array(exports_external.string().min(1)).default([])
}).strict().superRefine((value, ctx) => {
  if (value.relativePath.includes("*")) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "store relativePath must be a concrete directory; use glob fields for files",
      path: ["relativePath"]
    });
  }
  const adapterIds = new Set;
  for (const [index, adapter] of value.retentionAdapters.entries()) {
    if (adapterIds.has(adapter.id)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "retention adapter ids must be unique within a store",
        path: ["retentionAdapters", index, "id"]
      });
    }
    adapterIds.add(adapter.id);
  }
});
var SecureLocalStorePolicySchema = contractBaseSchema(SCHEMA_IDS.secureLocalStorePolicy).extend({
  version: exports_external.string().min(1),
  scope: exports_external.array(LocalStoreRootSchema).min(1),
  defaults: exports_external.object({
    directoryMode: OwnerOnlyDirectoryModeSchema.default("0700"),
    fileMode: OwnerOnlyFileModeSchema.default("0600"),
    dryRunDefault: exports_external.literal(true),
    requireExplicitApply: exports_external.literal(true),
    includeSqliteSidecars: exports_external.literal(true),
    redactedEvidenceOnly: exports_external.literal(true)
  }).strict(),
  stores: exports_external.array(SecureLocalStoreDefinitionSchema).min(1),
  lifecycle: exports_external.object({
    retentionDryRunDefault: exports_external.literal(true),
    requireActiveRecordExclusionProof: exports_external.literal(true),
    requireArtifactAllowlist: exports_external.literal(true),
    sqliteMaintenanceRequiresExclusiveAccess: exports_external.literal(true)
  }).strict(),
  warnings: exports_external.array(exports_external.string().min(1)).default([])
}).strict().superRefine((value, ctx) => {
  const stores = new Set;
  for (const [index, store] of value.stores.entries()) {
    if (stores.has(store.storeId)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "store ids must be unique",
        path: ["stores", index, "storeId"]
      });
    }
    stores.add(store.storeId);
    if (!value.scope.includes(store.root)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "store root must be listed in policy scope",
        path: ["stores", index, "root"]
      });
    }
  }
});
var PUBLISH_STATUSES = ["published", "unpublished"];
var PublishStatusSchema = exports_external.enum(PUBLISH_STATUSES);
var PUBLISH_MECHANISMS = ["ci", "manual"];
var PublishMechanismSchema = exports_external.enum(PUBLISH_MECHANISMS);
var PUBLISH_CREDENTIALS = ["trusted-publisher", "token"];
var PublishCredentialSchema = exports_external.enum(PUBLISH_CREDENTIALS);
var PUBLISH_FLOWS = ["direct", "staged"];
var PublishFlowSchema = exports_external.enum(PUBLISH_FLOWS);
var PROVENANCE_MODES = ["required", "best-effort", "none"];
var ProvenanceModeSchema = exports_external.enum(PROVENANCE_MODES);
var PUBLISH_WORKFLOW_PROVIDERS = ["github-actions", "gitlab-ci"];
var PublishWorkflowProviderSchema = exports_external.enum(PUBLISH_WORKFLOW_PROVIDERS);
var PublishWorkflowSchema = exports_external.object({
  provider: PublishWorkflowProviderSchema,
  repository: exports_external.string().regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, "Workflow repository must be owner/repo"),
  file: exports_external.string().regex(/^[A-Za-z0-9._-]+\.ya?ml$/, "Workflow file must be a bare .yml/.yaml filename, not a path"),
  environment: exports_external.string().min(1).optional()
}).strict();
var PublishTargetSchema = exports_external.object({
  package: exports_external.string().regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/, "Package must be a registry package name, optionally scoped"),
  registry: exports_external.string().regex(/^[a-z0-9][a-z0-9.-]*(?::[0-9]+)?(?:\/[A-Za-z0-9._~-]+)*$/, "Registry must be a bare host[:port][/path] with no scheme and no credentials"),
  access: exports_external.enum(["public", "restricted"]).optional(),
  mechanism: PublishMechanismSchema,
  credential: PublishCredentialSchema,
  flow: PublishFlowSchema.default("direct"),
  provenance: ProvenanceModeSchema.default("none"),
  workflow: PublishWorkflowSchema.optional()
}).strict().superRefine((value, ctx) => {
  if (value.mechanism === "ci" && !value.workflow) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "mechanism=ci requires workflow (the registry registration needs repository, file, and environment)",
      path: ["workflow"]
    });
  }
  if (value.mechanism === "manual" && value.workflow) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "mechanism=manual must not declare workflow; a workflow implies mechanism=ci",
      path: ["workflow"]
    });
  }
  if (value.credential === "trusted-publisher" && value.mechanism !== "ci") {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "credential=trusted-publisher requires mechanism=ci; workload identity is not issuable to an interactive publish",
      path: ["credential"]
    });
  }
});
var PublishingContractSchema = exports_external.object({
  status: PublishStatusSchema,
  targets: exports_external.array(PublishTargetSchema).default([])
}).strict().superRefine((value, ctx) => {
  if (value.status === "published" && value.targets.length === 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "publishing.status=published requires at least one target",
      path: ["targets"]
    });
  }
  if (value.status === "unpublished" && value.targets.length > 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "publishing.status=unpublished must not declare targets",
      path: ["targets"]
    });
  }
  const seen = new Set;
  for (const [index, target] of value.targets.entries()) {
    const key = `${target.package}@${target.registry}`;
    if (seen.has(key)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `Duplicate publish target for ${target.package} at ${target.registry}`,
        path: ["targets", index, "package"]
      });
    }
    seen.add(key);
  }
});
var ServiceContractManifestSchema = exports_external.object({
  $schema: exports_external.string().min(1).optional(),
  schema: exports_external.literal(SCHEMA_IDS.serviceContract),
  name: AppNameSchema,
  class: RepoClassSchema,
  contractVersion: exports_external.literal(SERVICE_CONTRACT_VERSION),
  kitVersion: exports_external.string().min(1),
  description: exports_external.string().min(1).optional(),
  bins: exports_external.array(exports_external.string().min(1)).default([]),
  storage: StorageContractSchema.optional(),
  hosting: exports_external.array(HostingModeSchema).min(1).default(["user-hosted"]),
  serviceSurfaces: exports_external.array(ServiceSurfaceSchema).default([]),
  publishing: PublishingContractSchema.optional(),
  metadata: ServiceContractMetadataSchema.optional()
}).strict().superRefine((value, ctx) => {
  if (new Set(value.hosting).size !== value.hosting.length) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "hosting must not contain duplicates",
      path: ["hosting"]
    });
  }
  const allowed = new Set(allowedBinsForName(value.name));
  const seenBins = new Set;
  for (const [index, bin] of value.bins.entries()) {
    if (seenBins.has(bin)) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "Duplicate bin declaration", path: ["bins", index] });
    }
    seenBins.add(bin);
    if (!allowed.has(bin)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `Bin "${bin}" is not allowlisted for app "${value.name}"; allowed: ${[...allowed].join(", ")}`,
        path: ["bins", index]
      });
    }
  }
  const hasBin = (suffix) => seenBins.has(`${value.name}${suffix}`);
  if (value.storage) {
    const upper = value.name.toUpperCase().replace(/-/g, "_");
    if (value.storage.envPrefix && value.storage.envPrefix !== `HASNA_${upper}_`) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `storage.envPrefix must be HASNA_${upper}_`,
        path: ["storage", "envPrefix"]
      });
    }
    if (value.storage.databaseUrlSecretRef && value.storage.databaseUrlSecretRef !== databaseUrlSecretRefFor(value.name)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `storage.databaseUrlSecretRef must be ${databaseUrlSecretRefFor(value.name)}`,
        path: ["storage", "databaseUrlSecretRef"]
      });
    }
  }
  if (value.class === "library") {
    if (value.storage) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "library repos must not declare storage", path: ["storage"] });
    }
    if (hasBin("-serve") || hasBin("-mcp")) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "library repos must not ship a -serve or -mcp bin",
        path: ["bins"]
      });
    }
  }
  if (value.class === "cli-with-store") {
    if (!value.storage) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "cli-with-store repos must declare storage", path: ["storage"] });
    } else {
      if (value.storage.engines) {
        const declaredEngines = new Set(value.storage.engines);
        const declaredWaivers = value.metadata?.conformance?.waivedStorageEngines ?? [];
        const ineligible = storageWaiverIneligibilityReason({
          class: value.class,
          name: value.name,
          bins: value.bins,
          hosting: value.hosting,
          storageBackend: value.storage.backend,
          serviceSurfaces: value.serviceSurfaces
        });
        const waivedEngines = new Set(ineligible ? [] : declaredWaivers.map((waiver) => waiver.engine));
        const missingEngines = STORAGE_ENGINES.filter((engine) => !declaredEngines.has(engine) && !waivedEngines.has(engine));
        if (missingEngines.length > 0) {
          const refusal = ineligible && declaredWaivers.length > 0 ? `; declared waiver ignored: ${ineligible}` : "";
          ctx.addIssue({
            code: exports_external.ZodIssueCode.custom,
            message: `cli-with-store storage.engines must declare sqlite and postgresql unless bounded migration tooling carries a metadata.conformance.waivedStorageEngines waiver; missing: ${missingEngines.join(", ")}${refusal}`,
            path: ["storage", "engines"]
          });
        }
      }
    }
    if (!seenBins.has(value.name)) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: `cli-with-store repos must ship the "${value.name}" bin`, path: ["bins"] });
    }
  }
  if (value.class === "service") {
    if (!value.storage) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "service repos must declare storage", path: ["storage"] });
    } else if (value.storage.engines) {
      if (!value.storage.engines.includes("postgresql")) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "service storage.engines must declare postgresql; local engines are optional migration/import capabilities only",
          path: ["storage", "engines"]
        });
      }
    }
    if (!hasBin("-serve")) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: `service repos must ship the "${value.name}-serve" bin`, path: ["bins"] });
    }
    if (value.serviceSurfaces.length === 0) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "service repos must declare at least one service surface",
        path: ["serviceSurfaces"]
      });
    }
  }
  if (value.class === "saas") {
    if (!value.storage) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "saas repos must declare storage", path: ["storage"] });
    } else {
      if (value.storage.backend !== "postgresql") {
        ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "saas repos must use the postgresql storage backend", path: ["storage", "backend"] });
      }
      if (!value.storage.envPrefix) {
        ctx.addIssue({
          code: exports_external.ZodIssueCode.custom,
          message: "saas storage requires envPrefix for the public DATABASE_URL contract",
          path: ["storage", "envPrefix"]
        });
      }
    }
    if (!hasBin("-serve")) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: `saas repos must ship the "${value.name}-serve" bin`, path: ["bins"] });
    }
    if (value.serviceSurfaces.length === 0) {
      ctx.addIssue({ code: exports_external.ZodIssueCode.custom, message: "saas repos must declare at least one service surface", path: ["serviceSurfaces"] });
    }
  }
  for (const [index, surface] of value.serviceSurfaces.entries()) {
    if (surface.bin && !seenBins.has(surface.bin)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `Service surface bin "${surface.bin}" must be declared in bins`,
        path: ["serviceSurfaces", index, "bin"]
      });
    }
    if (surface.mcpBin && !seenBins.has(surface.mcpBin)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `Service surface MCP bin "${surface.mcpBin}" must be declared in bins`,
        path: ["serviceSurfaces", index, "mcpBin"]
      });
    }
  }
  const waivedKinds = value.metadata?.conformance?.waivedSurfaces ?? [];
  const seenWaivers = new Set;
  for (const [index, waiver] of waivedKinds.entries()) {
    if (seenWaivers.has(waiver.kind)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `Duplicate conformance waiver for ${waiver.kind}`,
        path: ["metadata", "conformance", "waivedSurfaces", index, "kind"]
      });
    }
    seenWaivers.add(waiver.kind);
  }
  const waivedStorageEngines = value.metadata?.conformance?.waivedStorageEngines ?? [];
  const seenStorageWaivers = new Set;
  for (const [index, waiver] of waivedStorageEngines.entries()) {
    if (seenStorageWaivers.has(waiver.engine)) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `Duplicate storage-engine waiver for ${waiver.engine}`,
        path: ["metadata", "conformance", "waivedStorageEngines", index, "engine"]
      });
    }
    seenStorageWaivers.add(waiver.engine);
  }
});
var HealthResponseSchema = exports_external.object({
  status: exports_external.enum(["ok", "degraded", "unavailable"]),
  version: exports_external.string().min(1),
  backend: ServerDataBackendSchema
}).strict();
var ReadyResponseSchema = exports_external.object({
  ready: exports_external.boolean(),
  reason: exports_external.string().min(1).optional()
}).strict();
var VersionResponseSchema = exports_external.object({
  version: exports_external.string().min(1)
}).strict();
var CommsSeveritySchema = exports_external.enum(["info", "notice", "breaking", "critical"]);
var CommsEventTypeSchema = exports_external.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$/, "Comms event types must be 2-4 lowercase dot-separated segments (<source>.<entity>.<action>)");
var COMMS_SEVERITY_TAGS = ["FREEZE", "UNFREEZE", "BREAKING", "CUTOVER", "POLICY", "RELEASE"];
var CommsSeverityTagSchema = exports_external.enum(COMMS_SEVERITY_TAGS);
var CommsScopeSchema = exports_external.enum(["fleet", "package", "machine"]);
var CommsEventEnvelopeSchema = contractBaseSchema(SCHEMA_IDS.commsEventEnvelope).extend({
  type: CommsEventTypeSchema,
  severity: CommsSeveritySchema,
  scope: CommsScopeSchema,
  summary: exports_external.string().min(1).optional(),
  source: ActorPointerSchema.optional(),
  affected_packages: exports_external.array(NonEmptyStringSchema).default([]),
  affected_machines: exports_external.array(NonEmptyStringSchema).default([]),
  action_required: exports_external.boolean().default(false),
  ack_by: TimestampSchema.optional(),
  dedupe_key: NonEmptyStringSchema,
  resourceRefs: exports_external.array(ResourcePointerSchema).default([]),
  evidenceRefs: exports_external.array(EvidencePointerSchema).default([])
}).strict().superRefine((value, ctx) => {
  if (value.scope === "package" && value.affected_packages.length === 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Package-scoped comms events require affected_packages",
      path: ["affected_packages"]
    });
  }
  if (value.scope === "machine" && value.affected_machines.length === 0) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Machine-scoped comms events require affected_machines",
      path: ["affected_machines"]
    });
  }
  if (value.ack_by && !value.action_required) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: "Comms events with an ack_by deadline require action_required",
      path: ["action_required"]
    });
  }
  if (value.type === "fleet.freeze" || value.type === "fleet.unfreeze") {
    if (value.severity !== "critical") {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `${value.type} events are always critical`,
        path: ["severity"]
      });
    }
    if (value.scope !== "fleet") {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `${value.type} events are always fleet-scoped`,
        path: ["scope"]
      });
    }
    if (!value.action_required) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `${value.type} events require action_required`,
        path: ["action_required"]
      });
    }
  }
});
var CommsChannelClassSchema = exports_external.enum(["fleet", "package", "product", "loop-lane", "initiative", "personal"]);
var CommsChannelNoiseSchema = exports_external.enum(["quiet", "work", "firehose"]);
var CommsUntilHorizonSchema = NonEmptyStringSchema.refine((value) => /^(?:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?|gate:[0-9a-f][0-9a-f-]{7,35})$/.test(value), "until must be an ISO date (YYYY-MM-DD), a UTC timestamp, or a gate id (gate:<todos-id>)");
var CommsChannelMetadataSchema = contractBaseSchema(SCHEMA_IDS.commsChannelMetadata).extend({
  class: CommsChannelClassSchema,
  noise: CommsChannelNoiseSchema.optional(),
  owner: NonEmptyStringSchema.optional(),
  until: CommsUntilHorizonSchema.optional(),
  successor: NonEmptyStringSchema.optional()
}).strict().superRefine((value, ctx) => {
  if (value.class === "initiative") {
    if (!value.owner) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Initiative channels require an owner",
        path: ["owner"]
      });
    }
    if (!value.until) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: "Initiative channels require an until horizon (date or gate id)",
        path: ["until"]
      });
    }
  }
});
var COMMS_SEVERITY_TAG_INFO = {
  FREEZE: { defaultSeverity: "critical", allowedSeverities: ["critical"], requiredEventType: "fleet.freeze" },
  UNFREEZE: { defaultSeverity: "critical", allowedSeverities: ["critical"], requiredEventType: "fleet.unfreeze" },
  BREAKING: { defaultSeverity: "breaking", allowedSeverities: ["breaking"], requiredEventType: null },
  CUTOVER: { defaultSeverity: "notice", allowedSeverities: ["notice", "breaking"], requiredEventType: null },
  POLICY: { defaultSeverity: "breaking", allowedSeverities: ["notice", "breaking"], requiredEventType: null },
  RELEASE: { defaultSeverity: "info", allowedSeverities: ["info", "notice"], requiredEventType: null }
};
var CommsMessageMetadataSchema = contractBaseSchema(SCHEMA_IDS.commsMessageMetadata).extend({
  tag: CommsSeverityTagSchema,
  envelope: CommsEventEnvelopeSchema
}).strict().superRefine((value, ctx) => {
  const info = COMMS_SEVERITY_TAG_INFO[value.tag];
  if (!info.allowedSeverities.includes(value.envelope.severity)) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: `[${value.tag}] posts allow severities ${info.allowedSeverities.join(", ")}`,
      path: ["envelope", "severity"]
    });
  }
  if (info.requiredEventType && value.envelope.type !== info.requiredEventType) {
    ctx.addIssue({
      code: exports_external.ZodIssueCode.custom,
      message: `[${value.tag}] posts require event type ${info.requiredEventType}`,
      path: ["envelope", "type"]
    });
  }
  for (const [tag, tagInfo] of Object.entries(COMMS_SEVERITY_TAG_INFO)) {
    if (tagInfo.requiredEventType === value.envelope.type && value.tag !== tag) {
      ctx.addIssue({
        code: exports_external.ZodIssueCode.custom,
        message: `${value.envelope.type} events must use the [${tag}] tag`,
        path: ["tag"]
      });
    }
  }
});
var DEPLOYMENT_SCHEMAS = createDeploymentSchemas({
  actorPointer: ActorPointerSchema,
  costEstimate: CostEstimateSchema,
  decisionEnvelope: DecisionEnvelopeSchema,
  evidencePointer: EvidencePointerSchema,
  providerCapabilityCard: ProviderCapabilityCardSchema,
  resourcePointer: ResourcePointerSchema,
  validationPlan: ValidationPlanSchema,
  workRun: WorkRunSchema,
  schemaId: SchemaIdSchema,
  timestamp: TimestampSchema,
  uri: UriSchema,
  sha256Digest: Sha256DigestSchema,
  relativeProjectPath: RelativeProjectPathSchema,
  providerSideEffectClass: ProviderSideEffectClassSchema
});
var {
  ProductProjectionRefSchema,
  IntentSnapshotRefSchema,
  VerifiedSourceCandidateRefSchema,
  BuildArtifactRefSchema,
  ArtifactAttestationRefSchema,
  EnvironmentBindingRefSchema,
  DeploymentRequestRefSchema,
  DeploymentPlanRefSchema,
  DeploymentApprovalDecisionRefSchema,
  DeploymentAttemptRefSchema,
  ProviderReceiptRefSchema,
  DeploymentReceiptRefSchema,
  ProductProjectionSchema,
  IntentSnapshotSchema,
  VerifiedSourceCandidateSchema,
  BuildArtifactSchema,
  ArtifactAttestationSchema,
  EnvironmentBindingSchema,
  DeploymentRequestSchema,
  DeploymentActionSchema,
  DeploymentPlanSchema,
  DeploymentApprovalDecisionSchema,
  DeploymentAttemptSchema,
  ProviderReceiptSchema,
  DeploymentReceiptSchema,
  LaunchEvidenceSchema,
  DeploymentSchemaRegistry
} = DEPLOYMENT_SCHEMAS;
var DEPLOYMENT_ENVELOPE_SCHEMAS = createDeploymentEnvelopeSchema({
  timestamp: TimestampSchema,
  metadata: MetadataSchema,
  appId: AppIdSchema,
  npmPackageName: NpmPackageNameSchema,
  uri: UriSchema,
  resourcePointer: ResourcePointerSchema,
  evidencePointer: EvidencePointerSchema,
  providerSideEffectClass: ProviderSideEffectClassSchema,
  productProjectionRef: ProductProjectionRefSchema,
  environmentBindingRef: EnvironmentBindingRefSchema,
  buildArtifactRef: BuildArtifactRefSchema,
  deploymentPlanRef: DeploymentPlanRefSchema,
  deploymentReceiptRef: DeploymentReceiptRefSchema
});
var {
  DeploymentEnvelopeSchema,
  EnvelopeResourceSchema,
  EnvelopeEnvironmentSchema,
  EnvelopePhaseSchema,
  EnvelopeActionSchema
} = DEPLOYMENT_ENVELOPE_SCHEMAS;
var CoreContractSchemaRegistry = {
  [SCHEMA_IDS.actorRef]: ActorRefSchema,
  [SCHEMA_IDS.resourceRef]: ResourceRefSchema,
  [SCHEMA_IDS.evidenceRef]: EvidenceRefSchema,
  [SCHEMA_IDS.workRun]: WorkRunSchema,
  [SCHEMA_IDS.taskToPrProjection]: TaskToPrProjectionSchema,
  [SCHEMA_IDS.decisionEnvelope]: DecisionEnvelopeSchema,
  [SCHEMA_IDS.costEstimate]: CostEstimateSchema,
  [SCHEMA_IDS.capabilityCard]: CapabilityCardSchema,
  [SCHEMA_IDS.providerLiveModeStandard]: ProviderLiveModeStandardSchema,
  [SCHEMA_IDS.contextPack]: ContextPackSchema,
  [SCHEMA_IDS.integrationRef]: IntegrationRefSchema,
  [SCHEMA_IDS.projectManifest]: ProjectManifestSchema,
  [SCHEMA_IDS.projectPanel]: ProjectPanelSchema,
  [SCHEMA_IDS.projectSnapshot]: ProjectSnapshotSchema,
  [SCHEMA_IDS.renderManifest]: RenderManifestSchema,
  [SCHEMA_IDS.agentTrajectory]: AgentTrajectorySchema,
  [SCHEMA_IDS.validationPlan]: ValidationPlanSchema,
  [SCHEMA_IDS.proofBundle]: ProofBundleSchema,
  [SCHEMA_IDS.scaffoldManifest]: ScaffoldManifestSchema,
  [SCHEMA_IDS.scaffoldInstallRecord]: ScaffoldInstallRecordSchema,
  [SCHEMA_IDS.appCloudManifest]: AppCloudManifestSchema,
  [SCHEMA_IDS.noCloudEvidencePack]: NoCloudEvidencePackSchema,
  [SCHEMA_IDS.secureLocalStorePolicy]: SecureLocalStorePolicySchema,
  [SCHEMA_IDS.serviceContract]: ServiceContractManifestSchema,
  [SCHEMA_IDS.commsEventEnvelope]: CommsEventEnvelopeSchema,
  [SCHEMA_IDS.commsChannelMetadata]: CommsChannelMetadataSchema,
  [SCHEMA_IDS.commsMessageMetadata]: CommsMessageMetadataSchema,
  [SCHEMA_IDS.projectResourceLinkCollectionV1]: ProjectResourceLinkCollectionV1Schema,
  [SCHEMA_IDS.app]: AppSchema,
  [SCHEMA_IDS.release]: ReleaseSchema,
  [SCHEMA_IDS.rolloutRecord]: RolloutRecordSchema,
  [SCHEMA_IDS.announcement]: AnnouncementSchema,
  [SCHEMA_IDS.audience]: AudienceSchema,
  [SCHEMA_IDS.deploymentEnvelope]: DeploymentEnvelopeSchema
};
var ContractSchemaRegistry = {
  ...CoreContractSchemaRegistry,
  ...DeploymentSchemaRegistry
};

// src/no-cloud.ts
import { readdirSync, readFileSync, statSync } from "fs";
import { basename, join as join2, relative, resolve as resolve2 } from "path";

// src/dependency-edge.ts
var PRODUCTION_SECTIONS = ["dependencies", "optionalDependencies", "peerDependencies"];
var DEVELOPMENT_SECTIONS = ["devDependencies"];
var PIN_SECTIONS = ["overrides", "resolutions"];
var NAME_LIST_SECTIONS = ["bundleDependencies", "bundledDependencies", "trustedDependencies"];
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function parseLooseJson(text) {
  try {
    return JSON.parse(text);
  } catch {}
  const chars = [...text];
  let inString = false;
  for (let index = 0;index < chars.length; index += 1) {
    const character = chars[index];
    if (inString) {
      if (character === "\\")
        index += 1;
      else if (character === '"')
        inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character !== ",")
      continue;
    let ahead = index + 1;
    while (ahead < chars.length && /\s/.test(chars[ahead]))
      ahead += 1;
    if (chars[ahead] === "}" || chars[ahead] === "]")
      chars[index] = " ";
  }
  try {
    return JSON.parse(chars.join(""));
  } catch {
    return null;
  }
}
var MAX_PIN_DEPTH = 4;
function pinKeyNames(key) {
  const segments = key.split("/").filter((segment) => segment !== "" && segment !== "*" && segment !== "**");
  const names = [];
  for (let index = 0;index < segments.length; index += 1) {
    const segment = segments[index];
    const next = segments[index + 1];
    if (segment.startsWith("@") && next !== undefined) {
      names.push(`${segment}/${next}`);
      index += 1;
      continue;
    }
    names.push(segment);
  }
  return names.map((name) => nameFromResolutionId(name) ?? name);
}
function pinNames(pins, depth) {
  const names = [];
  for (const [key, value] of Object.entries(pins)) {
    names.push(...pinKeyNames(key));
    if (isRecord(value) && depth < MAX_PIN_DEPTH)
      names.push(...pinNames(value, depth + 1));
  }
  return names;
}
function namesInSection(container, section) {
  const value = container[section];
  if (Array.isArray(value))
    return value.filter((entry) => typeof entry === "string");
  if (!isRecord(value))
    return [];
  return PIN_SECTIONS.includes(section) ? pinNames(value, 0) : Object.keys(value);
}
function manifestEdges(manifest, forbidden) {
  if (!isRecord(manifest))
    return [];
  const edges = [];
  const scopes = [
    { sections: [...PRODUCTION_SECTIONS, ...PIN_SECTIONS, ...NAME_LIST_SECTIONS], scope: "production" },
    { sections: DEVELOPMENT_SECTIONS, scope: "development" }
  ];
  for (const { sections, scope } of scopes) {
    for (const section of sections) {
      for (const name of namesInSection(manifest, section)) {
        if (!forbidden.includes(name))
          continue;
        edges.push({ packageName: name, scope, path: [name], source: "package.json", section });
      }
    }
  }
  return edges;
}
function isLinkedResolution(id) {
  const name = nameFromResolutionId(id);
  if (name === null)
    return false;
  return /^(?:file|link|workspace):/.test(id.slice(name.length + 1));
}
function nameFromResolutionId(id) {
  const separator = id.indexOf("@", id.startsWith("@") ? 1 : 0);
  if (separator <= 0)
    return null;
  return id.slice(0, separator);
}
function resolutionTarget(id) {
  const name = nameFromResolutionId(id);
  if (name === null)
    return null;
  const specifier = id.slice(name.length + 1);
  const aliased = /^npm:(.+)$/.exec(specifier);
  if (aliased) {
    const target2 = nameFromResolutionId(aliased[1]) ?? aliased[1];
    return target2 === name ? null : target2;
  }
  const linked = /^(?:file|link|workspace):(.+)$/.exec(specifier);
  if (!linked)
    return null;
  const segments = linked[1].split("/").filter((segment) => segment !== "" && segment !== "." && segment !== "..");
  const target = segments[segments.length - 1];
  return target === undefined || target === name ? null : target;
}
function aliasFromKey(key, keys) {
  let best = key;
  for (const candidate of keys) {
    if (candidate.length >= key.length)
      continue;
    if (!key.startsWith(`${candidate}/`))
      continue;
    const remainder = key.slice(candidate.length + 1);
    if (best === key || remainder.length < best.length)
      best = remainder;
  }
  return best;
}
function nodesByName(lock) {
  const byName = new Map;
  const packages = lock.packages;
  if (!isRecord(packages))
    return byName;
  const keys = new Set(Object.keys(packages));
  for (const [key, entry] of Object.entries(packages)) {
    if (!Array.isArray(entry))
      continue;
    const id = typeof entry[0] === "string" ? entry[0] : null;
    const name = (id ? nameFromResolutionId(id) : null) ?? key.split("/").slice(-1)[0] ?? key;
    const meta = entry.find((element) => isRecord(element));
    const node = {
      name,
      alias: id === null ? null : resolutionTarget(id),
      production: meta ? [...PRODUCTION_SECTIONS, ...PIN_SECTIONS, ...NAME_LIST_SECTIONS].flatMap((section) => namesInSection(meta, section)) : [],
      development: meta ? [...DEVELOPMENT_SECTIONS].flatMap((section) => namesInSection(meta, section)) : [],
      linked: id !== null && isLinkedResolution(id)
    };
    for (const lookup of new Set([name, aliasFromKey(key, keys)])) {
      const existing = byName.get(lookup);
      if (existing)
        existing.push(node);
      else
        byName.set(lookup, [node]);
    }
  }
  return byName;
}
function installRoots(lock) {
  const workspaces = lock.workspaces;
  if (!isRecord(workspaces))
    return [];
  const roots = [];
  for (const [key, record] of Object.entries(workspaces)) {
    if (!isRecord(record))
      continue;
    roots.push({ label: key === "" ? null : typeof record.name === "string" ? record.name : key, record });
  }
  const topLevel = {};
  for (const section of [...PIN_SECTIONS, ...NAME_LIST_SECTIONS]) {
    if (lock[section] !== undefined)
      topLevel[section] = lock[section];
  }
  const patched = lock.patchedDependencies;
  if (isRecord(patched)) {
    const names = Object.keys(patched).map((key) => nameFromResolutionId(key) ?? key).filter((name) => name.length > 0);
    if (names.length > 0)
      topLevel.dependencies = names;
  }
  if (Object.keys(topLevel).length > 0)
    roots.push({ label: null, record: topLevel });
  return roots;
}
function isHoistedInstall(lock) {
  const workspaces = lock.workspaces;
  if (!isRecord(workspaces))
    return false;
  return Object.values(workspaces).filter(isRecord).length <= 1;
}
function forbiddenIdentities(name, nodes, forbidden) {
  const found = new Set;
  if (forbidden.includes(name))
    found.add(name);
  for (const node of nodes) {
    if (forbidden.includes(node.name))
      found.add(node.name);
    if (node.alias !== null && forbidden.includes(node.alias))
      found.add(node.alias);
  }
  return [...found];
}
function forbiddenIdentity(name, nodes, forbidden) {
  return forbiddenIdentities(name, nodes, forbidden)[0] ?? null;
}
function lockfileWalk(lockText, forbidden) {
  const lock = parseLooseJson(lockText);
  if (!isRecord(lock))
    return null;
  const hoisted = isHoistedInstall(lock);
  const roots = installRoots(lock);
  if (roots.length === 0)
    return null;
  const nodes = nodesByName(lock);
  const clearedByLayout = new Set;
  const seeds = [];
  for (const { label, record } of roots) {
    const head = label === null ? [] : [label];
    for (const section of [...PRODUCTION_SECTIONS, ...PIN_SECTIONS, ...NAME_LIST_SECTIONS]) {
      for (const name of namesInSection(record, section))
        seeds.push({ name, trail: [...head, name], section, scope: "production", root: true });
    }
    for (const section of DEVELOPMENT_SECTIONS) {
      for (const name of namesInSection(record, section))
        seeds.push({ name, trail: [...head, name], section, scope: "development", root: true });
    }
  }
  const queue = [...seeds].sort((left, right) => left.scope === right.scope ? 0 : left.scope === "production" ? -1 : 1);
  const seen = new Set(queue.map((visit) => `${visit.scope}:${visit.name}`));
  const best = new Map;
  while (queue.length > 0) {
    const current = queue.shift();
    const known = nodes.get(current.name) ?? [];
    const reachable = hoisted ? known.filter((node) => current.root || !node.linked) : known;
    if (known.length > 0 && reachable.length === 0) {
      for (const dropped of forbiddenIdentities(current.name, known, forbidden))
        clearedByLayout.add(dropped);
      continue;
    }
    const identity = forbiddenIdentity(current.name, reachable, forbidden);
    if (identity !== null) {
      const existing = best.get(identity);
      if (!existing || existing.scope === "development" && current.scope === "production") {
        best.set(identity, {
          packageName: identity,
          scope: current.scope,
          path: current.trail[current.trail.length - 1] === identity ? current.trail : [...current.trail, identity],
          source: "bun.lock",
          section: current.section
        });
      }
    }
    for (const node of reachable) {
      const next = node.production.map((name) => ({ name, scope: current.scope }));
      if (node.linked) {
        for (const name of node.development)
          next.push({ name, scope: "development" });
      }
      for (const candidate of next) {
        const key = `${candidate.scope}:${candidate.name}`;
        if (seen.has(key))
          continue;
        seen.add(key);
        queue.push({ name: candidate.name, trail: [...current.trail, candidate.name], section: current.section, scope: candidate.scope, root: false });
      }
    }
  }
  return { edges: [...best.values()], clearedByLayout: [...clearedByLayout] };
}

// src/packed-artifact.ts
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
var MAX_ARCHIVE_MEMBER_BYTES = 5 * 1024 * 1024;
var MAX_SCANNED_MEMBER_BYTES = 512 * 1024 * 1024;
function isPackedArtifactPath(target) {
  return /\.(tgz|tar\.gz)$/i.test(target);
}
function extractArchive(target) {
  const directory = mkdtempSync(join(tmpdir(), "hasna-artifact-scan-"));
  try {
    execFileSync("tar", ["-xzf", resolve(target), "-C", directory], { stdio: "pipe" });
  } catch (error2) {
    rmSync(directory, { recursive: true, force: true });
    throw error2;
  }
  return directory;
}
function listArchiveEntries(target) {
  return execFileSync("tar", ["-tzf", target], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }).split(`
`).filter(Boolean);
}
function commonArchiveRoot(entries) {
  const firstSegments = new Set;
  for (const entry of entries) {
    const normalized = entry.replace(/^\.\/+/, "").replace(/^\/+/, "");
    if (!normalized || normalized.endsWith("/"))
      continue;
    const [first, ...rest] = normalized.split("/");
    if (!first || rest.length === 0)
      return null;
    firstSegments.add(first);
    if (firstSegments.size > 1)
      return null;
  }
  const [root] = [...firstSegments];
  return root ?? null;
}
function normalizeArchiveEntry(entry, commonRoot) {
  let normalized = entry.replace(/^\.\/+/, "").replace(/^\/+/, "");
  if (!normalized || normalized.endsWith("/"))
    return null;
  if (commonRoot && (normalized === commonRoot || normalized.startsWith(`${commonRoot}/`))) {
    normalized = normalized.slice(commonRoot.length).replace(/^\/+/, "");
  } else {
    normalized = normalized.replace(/^package\//, "");
  }
  return normalized || null;
}
function readArchiveMemberText(target, entry) {
  return execFileSync("tar", ["-xOzf", target, entry], {
    encoding: "utf8",
    maxBuffer: MAX_ARCHIVE_MEMBER_BYTES
  });
}

// src/source-text.ts
var C_LIKE_EXTENSIONS = /\.(?:[cm]?[jt]s)$/i;
var HASH_EXTENSIONS = /\.(?:sh|bash|ya?ml|toml)$/i;
function commentSyntaxForPath(path) {
  const name = path.replaceAll("\\", "/").split("/").pop() ?? path;
  if (name === ".env" || name.startsWith(".env."))
    return "hash";
  if (C_LIKE_EXTENSIONS.test(name))
    return "c-like";
  if (HASH_EXTENSIONS.test(name))
    return "hash";
  return "none";
}
function toUnits(text) {
  return text.split("");
}
function blank(chars, start, end) {
  for (let index = start;index < end; index += 1) {
    if (chars[index] !== `
`)
      chars[index] = " ";
  }
}
var VALUE_POSITION_KEYWORD = /(?:^|[^\w$])(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;
function regexCanStart(before) {
  const trimmed = before.replace(/\s+$/, "");
  if (trimmed === "")
    return true;
  const last = trimmed[trimmed.length - 1];
  if (/[\])}]/.test(last)) {
    return last === "}";
  }
  if (/[\w$]/.test(last))
    return VALUE_POSITION_KEYWORD.test(trimmed);
  if (last === "'" || last === '"' || last === "`")
    return false;
  return true;
}
var CONTROL_HEAD_KEYWORD = /(?:^|[^\w$])(?:if|for|while|switch|catch|with)\s*$/;
function ambiguityChangesTheMask(text, index) {
  const end = scanRegex(text, index);
  if (end === null)
    return false;
  const body = text.slice(index + 1, end);
  return body.includes("//") || body.includes("/*");
}
function slashOpensRegex(text, index, lastCloseParen) {
  const before = text.slice(Math.max(0, index - 64), index);
  if (!before.replace(/\s+$/, "").endsWith(")"))
    return regexCanStart(before);
  if (lastCloseParen === "control")
    return true;
  if (lastCloseParen === null || lastCloseParen === "unbalanced")
    return null;
  return ambiguityChangesTheMask(text, index) ? null : false;
}
var CALLEE_BEFORE_PAREN = /([A-Za-z_$][\w$]*)\s*$/;
var UNNAMEABLE_CALLEE = "()";
function calleeBefore(text, parenIndex) {
  const before = text.slice(Math.max(0, parenIndex - 96), parenIndex).replace(/\s+$/, "");
  if (before.endsWith(")") || before.endsWith("]"))
    return UNNAMEABLE_CALLEE;
  return CALLEE_BEFORE_PAREN.exec(before)?.[1] ?? null;
}
function lexCLike(text) {
  const tokens = [];
  let index = 0;
  const length = text.length;
  const templateDepths = [];
  let braceDepth = 0;
  const brackets = [];
  const parens = [];
  let lastCloseParen = null;
  const callArgumentOpeners = new Set;
  const enclosingCallees = () => brackets.filter((frame) => frame.paren).map((frame) => frame.callee);
  while (index < length) {
    const character = text[index];
    const next = text[index + 1];
    if (character === "/" && next === "/") {
      let end = text.indexOf(`
`, index);
      if (end === -1)
        end = length;
      tokens.push({ kind: "comment", start: index, end });
      index = end;
      continue;
    }
    if (character === "/" && next === "*") {
      const end = text.indexOf("*/", index + 2);
      if (end === -1)
        return null;
      tokens.push({ kind: "comment", start: index, end: end + 2 });
      index = end + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      const end = scanQuoted(text, index, character);
      if (end === null)
        return null;
      tokens.push({ kind: "literal", start: index, end, callees: enclosingCallees() });
      index = end;
      lastCloseParen = null;
      continue;
    }
    if (character === "`") {
      const chunk = scanTemplateChunk(text, index + 1);
      if (chunk === null)
        return null;
      tokens.push({ kind: "literal", start: index, end: chunk.index, callees: enclosingCallees() });
      if (!chunk.closed)
        templateDepths.push(braceDepth);
      index = chunk.index;
      lastCloseParen = null;
      continue;
    }
    if (character === "$" && next === "{" && templateDepths.length > 0) {
      braceDepth += 1;
      index += 2;
      lastCloseParen = null;
      continue;
    }
    if (character === "}" && templateDepths.length > 0 && braceDepth === templateDepths[templateDepths.length - 1] + 1) {
      braceDepth -= 1;
      const chunk = scanTemplateChunk(text, index + 1);
      if (chunk === null)
        return null;
      tokens.push({ kind: "literal", start: index, end: chunk.index, callees: enclosingCallees(), interpolated: true });
      if (chunk.closed)
        templateDepths.pop();
      index = chunk.index;
      lastCloseParen = null;
      continue;
    }
    if (character === "{")
      braceDepth += 1;
    if (character === "}" && braceDepth > 0)
      braceDepth -= 1;
    if (character === "(") {
      const control = CONTROL_HEAD_KEYWORD.test(text.slice(Math.max(0, index - 32), index));
      parens.push(control ? "control" : "value");
      brackets.push({ paren: true, callee: control ? null : calleeBefore(text, index) });
      lastCloseParen = null;
      index += 1;
      continue;
    }
    if (character === ")") {
      lastCloseParen = parens.pop() ?? "unbalanced";
      if (brackets[brackets.length - 1]?.paren)
        brackets.pop();
      index += 1;
      continue;
    }
    if (character === "[" || character === "{") {
      const enclosing = brackets[brackets.length - 1];
      if (enclosing?.paren === true && enclosing.callee !== null)
        callArgumentOpeners.add(index);
      brackets.push({ paren: false, callee: null });
      lastCloseParen = null;
      index += 1;
      continue;
    }
    if (character === "]" || character === "}") {
      if (brackets[brackets.length - 1]?.paren === false)
        brackets.pop();
      lastCloseParen = null;
      index += 1;
      continue;
    }
    if (character === "/") {
      const opensRegex = slashOpensRegex(text, index, lastCloseParen);
      if (opensRegex === null)
        return null;
      if (opensRegex) {
        const end = scanRegex(text, index);
        if (end !== null) {
          index = end;
          lastCloseParen = null;
          continue;
        }
      }
    }
    if (!/\s/.test(character))
      lastCloseParen = null;
    index += 1;
  }
  if (templateDepths.length > 0)
    return null;
  return { tokens, callArgumentOpeners };
}
function maskCLike(text) {
  const lexed = lexCLike(text);
  if (lexed === null)
    return null;
  const chars = toUnits(text);
  for (const token of lexed.tokens) {
    if (token.kind === "comment")
      blank(chars, token.start, token.end);
  }
  return chars.join("");
}
function scanQuoted(text, start, quote) {
  for (let index = start + 1;index < text.length; index += 1) {
    const character = text[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === quote)
      return index + 1;
    if (character === `
`)
      return null;
  }
  return null;
}
function scanTemplateChunk(text, start) {
  for (let index = start;index < text.length; index += 1) {
    const character = text[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "`")
      return { index: index + 1, closed: true };
    if (character === "$" && text[index + 1] === "{")
      return { index, closed: false };
  }
  return null;
}
function scanRegex(text, start) {
  let inClass = false;
  for (let index = start + 1;index < text.length; index += 1) {
    const character = text[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === `
`)
      return null;
    if (character === "[")
      inClass = true;
    else if (character === "]")
      inClass = false;
    else if (character === "/" && !inClass) {
      let end = index + 1;
      while (end < text.length && /[a-z]/i.test(text[end]))
        end += 1;
      return end;
    }
  }
  return null;
}
function maskHash(text) {
  const chars = toUnits(text);
  let lineStart = 0;
  while (lineStart <= text.length) {
    let lineEnd = text.indexOf(`
`, lineStart);
    if (lineEnd === -1)
      lineEnd = text.length;
    let inSingle = false;
    let inDouble = false;
    for (let index = lineStart;index < lineEnd; index += 1) {
      const character = text[index];
      if (character === "\\" && inDouble) {
        index += 1;
        continue;
      }
      if (character === "'" && !inDouble)
        inSingle = !inSingle;
      else if (character === '"' && !inSingle)
        inDouble = !inDouble;
      else if (character === "#" && !inSingle && !inDouble) {
        const previous = index === lineStart ? "" : text[index - 1];
        if (previous === "" || /\s/.test(previous)) {
          blank(chars, index, lineEnd);
          break;
        }
      }
    }
    if (lineEnd === text.length)
      break;
    lineStart = lineEnd + 1;
  }
  return chars.join("");
}
function maskComments(text, syntax) {
  if (syntax === "hash")
    return maskHash(text);
  if (syntax === "c-like")
    return maskCLike(text) ?? text;
  return text;
}
function maskCommentsForPath(text, path) {
  return maskComments(text, commentSyntaxForPath(path));
}
var INERT_CALLEES = new Set([
  "expect",
  "not",
  "toBe",
  "toEqual",
  "toStrictEqual",
  "toContain",
  "toContainEqual",
  "toMatch",
  "toMatchObject",
  "toHaveProperty",
  "toBeUndefined",
  "toBeDefined",
  "describe",
  "it",
  "test",
  "includes",
  "indexOf",
  "lastIndexOf",
  "startsWith",
  "endsWith",
  "has",
  "match",
  "search",
  "split",
  "concat",
  "existsSync",
  "statSync",
  "lstatSync",
  "readFileSync",
  "readdirSync",
  "join",
  "basename",
  "dirname",
  "extname",
  "relative",
  "normalize",
  "push",
  "add",
  "filter",
  "some",
  "every",
  "find",
  "map",
  "RegExp",
  "raw"
]);
function mentionsCannotLoad(text, path, moduleName) {
  if (commentSyntaxForPath(path) !== "c-like")
    return false;
  const lexed = lexCLike(text);
  if (lexed === null)
    return false;
  for (let at = text.indexOf(moduleName);at !== -1; at = text.indexOf(moduleName, at + 1)) {
    const end = at + moduleName.length;
    const token = lexed.tokens.find((candidate) => at >= candidate.start && end <= candidate.end);
    if (token?.kind === "comment")
      continue;
    if (token === undefined || token.kind !== "literal")
      return false;
    if (token.interpolated)
      return false;
    if (!(token.callees ?? []).every((callee) => callee === null || INERT_CALLEES.has(callee)))
      return false;
  }
  return true;
}
function escapeRegex2(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
var INLINE_DATA_WINDOW = 4096;
var IDENTIFIER_TAIL = /([A-Za-z_$][\w$]*)\s*$/;
var TYPE_POSITION_KEYWORD = /(?:^|[^\w$])readonly$/;
var RECORD_KEY_TAIL = /(?:[A-Za-z_$][\w$]*|"[^"\n]*"|'[^'\n]*')\s*$/;
function readStringLiteral(text, start) {
  const quote = text[start];
  if (quote !== '"' && quote !== "'" && quote !== "`")
    return null;
  let value = "";
  for (let index = start + 1;index < text.length; index += 1) {
    const character = text[index];
    if (character === "\\") {
      const escaped = text[index + 1];
      if (escaped === undefined)
        return null;
      value += escaped === "\\" || escaped === '"' || escaped === "'" || escaped === "`" ? escaped : `\\${escaped}`;
      index += 1;
      continue;
    }
    if (character === quote)
      return { value, end: index + 1 };
    if (quote === "`" && character === "$" && text[index + 1] === "{")
      return null;
    if (character === `
` && quote !== "`")
      return null;
    value += character;
  }
  return null;
}
function skipSpace(text, index) {
  let at = index;
  while (at < text.length && /\s/.test(text[at]))
    at += 1;
  return at;
}
function parseInlineData(text, start) {
  const opener = text[start];
  if (opener === '"' || opener === "'" || opener === "`") {
    const literal2 = readStringLiteral(text, start);
    return literal2 === null ? null : { kind: "string", value: literal2.value, start, end: literal2.end };
  }
  if (opener === "[") {
    const items = [];
    let index = skipSpace(text, start + 1);
    while (index < text.length) {
      if (text[index] === "]")
        return { kind: "array", items, start, end: index + 1 };
      const item = parseInlineData(text, index);
      if (item === null)
        return null;
      items.push(item);
      index = skipSpace(text, item.end);
      if (text[index] === ",")
        index = skipSpace(text, index + 1);
      else if (text[index] !== "]")
        return null;
    }
    return null;
  }
  if (opener === "{") {
    const entries = new Map;
    let index = skipSpace(text, start + 1);
    while (index < text.length) {
      if (text[index] === "}")
        return { kind: "record", entries, start, end: index + 1 };
      const quoted = readStringLiteral(text, index);
      let key;
      if (quoted !== null) {
        key = quoted.value;
        index = skipSpace(text, quoted.end);
      } else {
        const identifier = /^[A-Za-z_$][\w$]*/.exec(text.slice(index, index + 128));
        if (identifier === null)
          return null;
        key = identifier[0];
        index = skipSpace(text, index + identifier[0].length);
      }
      if (text[index] !== ":")
        return null;
      index = skipSpace(text, index + 1);
      const value = parseInlineData(text, index);
      if (value === null)
        return null;
      if (entries.has(key))
        return null;
      entries.set(key, value);
      index = skipSpace(text, value.end);
      if (text[index] === ",")
        index = skipSpace(text, index + 1);
      else if (text[index] !== "}")
        return null;
    }
    return null;
  }
  return null;
}
function recordKeyPrecedes(before) {
  const key = RECORD_KEY_TAIL.exec(before);
  if (key === null)
    return false;
  const head = before.slice(0, key.index).replace(/\s+$/, "");
  return head.endsWith("{") || head.endsWith(",");
}
function isInertPosition(text, start, end, callArgumentOpeners) {
  if (callArgumentOpeners.has(start))
    return false;
  const before = text.slice(Math.max(0, start - 64), start).replace(/\s+$/, "");
  if (before !== "") {
    const last = before[before.length - 1];
    const typePosition = TYPE_POSITION_KEYWORD.test(before);
    if (!typePosition && !(last === "=" || last === "[" || last === "," || last === ":" || last === "("))
      return false;
    if (last === "=" && /[=!<>]$/.test(before.slice(0, -1)))
      return false;
    if (last === "(" && IDENTIFIER_TAIL.test(before.slice(0, -1)))
      return false;
    if (!typePosition && last === ":" && !recordKeyPrecedes(before.slice(0, -1).replace(/\s+$/, "")))
      return false;
  }
  const after = skipSpace(text, end);
  const next = text.slice(after, after + 2);
  if (next.startsWith("[") || next.startsWith("(") || next.startsWith(".") || next.startsWith("?."))
    return false;
  return true;
}
function boundNameBefore(text, start) {
  const before = text.slice(Math.max(0, start - 128), start).replace(/\s+$/, "");
  if (!before.endsWith("="))
    return null;
  return IDENTIFIER_TAIL.exec(before.slice(0, -1))?.[1] ?? null;
}
function inlineDataRegions(text, needles) {
  const regions = [];
  const seen = new Set;
  let lexed;
  for (const needle of needles) {
    for (let at = text.indexOf(needle);at !== -1; at = text.indexOf(needle, at + 1)) {
      if (lexed === undefined)
        lexed = lexCLike(text);
      if (lexed === null)
        return regions;
      const floor = Math.max(0, at - INLINE_DATA_WINDOW);
      const openers = [];
      for (let back = at;back >= floor; back -= 1) {
        const character = text[back];
        if (character === "[" || character === "{")
          openers.push(back);
      }
      for (const opener of openers.reverse()) {
        const root = parseInlineData(text, opener);
        if (root === null || root.kind === "string")
          continue;
        if (!(root.start <= at && at + needle.length <= root.end))
          continue;
        if (seen.has(opener))
          break;
        if (!isInertPosition(text, root.start, root.end, lexed.callArgumentOpeners))
          break;
        seen.add(opener);
        regions.push({ root, boundName: boundNameBefore(text, root.start), start: root.start, end: root.end });
        break;
      }
    }
  }
  return regions;
}
var LOAD_CALLEE = String.raw`(?:^|[^\w$])(?:_*(?:import|require)|createRequire|Module\s*\.\s*_load)`;
var LOAD_ARGUMENT_WINDOW = 4096;
function loadCallArguments(text, open) {
  const limit = Math.min(text.length, open + LOAD_ARGUMENT_WINDOW);
  let depth = 0;
  for (let index = open;index < limit; index += 1) {
    const character = text[index];
    if (character === '"' || character === "'" || character === "`") {
      const literalEnd = character === "`" ? scanTemplateLiteral(text, index) : scanQuoted(text, index, character);
      if (literalEnd !== null) {
        index = literalEnd - 1;
        continue;
      }
    }
    if (character === "(" || character === "[" || character === "{")
      depth += 1;
    else if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
      if (depth === 0)
        return text.slice(open + 1, index);
    }
  }
  return text.slice(open + 1, limit);
}
function scanTemplateLiteral(text, start) {
  for (let index = start + 1;index < text.length; index += 1) {
    const character = text[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "`")
      return index + 1;
  }
  return null;
}
function loadCallMentions(text, name) {
  const calls = new RegExp(`${LOAD_CALLEE}\\s*\\(`, "g");
  const bounded = new RegExp(`[^\\w$]${escapeRegex2(name)}(?![\\w$])`);
  for (const match of text.matchAll(calls)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    if (bounded.test(` ${loadCallArguments(text, open)}`))
      return true;
  }
  return false;
}
function blankSpans(text, spans) {
  if (spans.length === 0)
    return text;
  const chars = toUnits(text);
  for (const span of spans)
    blank(chars, span.start, span.end);
  return chars.join("");
}
function quoteCharacter(character) {
  return character === '"' || character === "'" || character === "`";
}
function quotedConstantSpan(text, node, expected) {
  if (node === undefined)
    return null;
  const raw = text.slice(node.start, node.end);
  const quote = raw[0];
  if (!quoteCharacter(quote))
    return null;
  if (raw !== `${quote}${expected}${quote}`)
    return null;
  return { start: node.start, end: node.end, constant: expected };
}
function blankConstantSpans(text, spans) {
  for (const span of spans) {
    const raw = text.slice(span.start, span.end);
    const quote = raw[0];
    if (!quoteCharacter(quote) || raw !== `${quote}${span.constant}${quote}`) {
      throw new Error(`refusing to blank ${span.start}..${span.end}: its bytes are not the constant it claims`);
    }
  }
  return blankSpans(text, spans);
}
var SPECIFIER_QUOTE = "[\"'`]";
var SPECIFIER_CHAR = "[^\"'`]";
function moduleSpecifier(moduleName) {
  return `${SPECIFIER_QUOTE}(?:${SPECIFIER_CHAR}*/)?${escapeRegex2(moduleName)}(?:/${SPECIFIER_CHAR}*)?${SPECIFIER_QUOTE}`;
}
function importsModule(maskedText, moduleName) {
  const pattern = new RegExp(String.raw`(?:\bfrom\s*|${LOAD_CALLEE}\s*\(\s*|\bimport\s*)` + moduleSpecifier(moduleName));
  return pattern.test(maskedText);
}
function importedBindings(maskedText, moduleName) {
  const bindings = new Set;
  const specifier = moduleSpecifier(moduleName);
  const statement = new RegExp(String.raw`\b(?:import|export)\s+([^;]*?)\bfrom\s*${specifier}`, "g");
  const assignment = new RegExp(String.raw`(?:const|let|var)\s+([^=;]*?)=\s*(?:await\s+)?_*(?:require|import)\s*\(\s*${specifier}\s*\)`, "g");
  for (const pattern of [statement, assignment]) {
    for (const match of maskedText.matchAll(pattern)) {
      for (const name of clauseBindings(match[1] ?? ""))
        bindings.add(name);
    }
  }
  return bindings;
}
var IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
function clauseBindings(clause) {
  const names = [];
  const braced = /\{([^}]*)\}/.exec(clause);
  if (braced) {
    for (const part of braced[1].split(",")) {
      const pieces = part.split(/\s+as\s+|:/);
      const name = (pieces[pieces.length - 1] ?? "").trim();
      if (IDENTIFIER.test(name))
        names.push(name);
    }
  }
  const namespace = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause);
  if (namespace)
    names.push(namespace[1]);
  const head = clause.replace(/\{[^}]*\}/g, "").replace(/\*\s+as\s+[A-Za-z_$][\w$]*/g, "");
  for (const part of head.split(",")) {
    const name = part.replace(/\btype\b/g, "").trim();
    if (IDENTIFIER.test(name))
      names.push(name);
  }
  return names;
}

// src/no-cloud.ts
var SKIP_DIRS = new Set([".git", "node_modules", ".cache", ".next", ".turbo", "coverage", "docs", "examples", "tests"]);
var LOCKFILES = new Set(["bun.lock", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);
var SOURCE_DIRS = new Set(["src", "bin", "cli", "mcp", "server", "lib", "scripts", "config", "infra", "hooks", ".github", "dist"]);
var MAX_TEXT_BYTES = 5 * 1024 * 1024;
var RUNTIME_PATTERNS = [
  { pattern: "@hasna/cloud", kind: "module", message: "Shared @hasna/cloud runtime reference is forbidden" },
  { pattern: "open-cloud", kind: "module", message: "Shared open-cloud runtime reference is forbidden" },
  { pattern: "cloud-mcp", kind: "module", message: "Legacy cloud-mcp runtime surface is forbidden" },
  { pattern: "registerCloudTools", kind: "symbol", message: "Legacy registerCloudTools runtime surface is forbidden" },
  { pattern: "registerCloudCommands", kind: "symbol", message: "Legacy registerCloudCommands runtime surface is forbidden" },
  { pattern: ".hasna/cloud", kind: "config", checkKind: "runtime_config", message: "Legacy .hasna/cloud runtime config is forbidden" },
  { pattern: "HASNA_CLOUD_", kind: "config", message: "Shared HASNA_CLOUD_* runtime config is forbidden" },
  { pattern: "HASNA_RDS_PASSWORD", kind: "config", message: "Legacy shared RDS credential config is forbidden" }
];
var PATH_CONFIG_PATTERNS = RUNTIME_PATTERNS.filter((entry) => ("checkKind" in entry));
var MODULE_PATTERNS = RUNTIME_PATTERNS.filter((entry) => entry.kind === "module");
var FORBIDDEN_LOCKFILE_PACKAGES = [
  ...new Set([...FORBIDDEN_SHARED_CLOUD_RUNTIMES, ...MODULE_PATTERNS.map((entry) => entry.pattern)])
];
var LOCKFILE_TEXT_PATTERNS = RUNTIME_PATTERNS.filter((entry) => entry.kind === "config");
function lockfileNamesPackage(text, packageName) {
  return new RegExp(`(?:^|["/])${packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=["@/])`).test(text);
}
var NO_CLOUD_GUARD_TEST = /^src\/no-cloud-boundary\.test\.(?:[cm]?[jt]sx?|[cm]ts)$/;
var DYNAMIC_MODULE_LOAD = /\b(?:import|require)\s*\(\s*(?!(["'])[^"'\n]*\1\s*\))/;
var MODULE_RESOLUTION_CAPABILITY = /\b(?:createRequire|resolveSync|process\.binding|dlopen|eval|Function)\s*\(|\brequire\s*\.\s*resolve\b|\bimport\s*\.\s*meta\s*\.\s*resolve\b|\bBun\s*\.\s*plugin\b|\bnew\s+(?:URL|Worker|SharedWorker|Function)\s*\(/;
function isNoCloudGuardTest(path) {
  return NO_CLOUD_GUARD_TEST.test(path.replaceAll("\\", "/"));
}
function guardTestMentionsOnly(file, masked) {
  if (!isNoCloudGuardTest(file.path))
    return false;
  if (MODULE_RESOLUTION_CAPABILITY.test(masked))
    return false;
  if (DYNAMIC_MODULE_LOAD.test(masked))
    return false;
  return MODULE_PATTERNS.every((module) => mentionsCannotLoad(file.text, file.path, module.pattern));
}
function ownPatternDeclarationSpans(text, node) {
  if (node.kind === "array") {
    if (node.items.length !== FORBIDDEN_SHARED_CLOUD_RUNTIMES.length)
      return null;
    const spans = [];
    for (const [index, item] of node.items.entries()) {
      const span = quotedConstantSpan(text, item, FORBIDDEN_SHARED_CLOUD_RUNTIMES[index]);
      if (span === null)
        return null;
      spans.push(span);
    }
    return spans;
  }
  if (node.kind !== "record")
    return null;
  for (const row of RUNTIME_PATTERNS) {
    const keys = Object.keys(row);
    if (keys.length !== node.entries.size)
      continue;
    const spans = [];
    for (const key of keys) {
      const span = quotedConstantSpan(text, node.entries.get(key), row[key]);
      if (span === null)
        break;
      spans.push(span);
    }
    if (spans.length === keys.length)
      return spans;
  }
  return null;
}
function withoutInlinedDeclarations(masked, path) {
  if (commentSyntaxForPath(path) !== "c-like")
    return masked;
  const spans = [];
  for (const region of inlineDataRegions(masked, RUNTIME_PATTERNS.map((entry) => entry.pattern))) {
    if (region.boundName !== null && loadCallMentions(masked, region.boundName))
      continue;
    for (const node of [region.root, ...region.root.kind === "array" ? region.root.items : []]) {
      const verified = ownPatternDeclarationSpans(masked, node);
      if (verified !== null)
        spans.push(...verified);
    }
  }
  return blankConstantSpans(masked, spans);
}
function stableId(input) {
  let hash = 0;
  for (let index = 0;index < input.length; index += 1) {
    hash = Math.imul(31, hash) + input.charCodeAt(index);
  }
  return Math.abs(hash >>> 0).toString(36);
}
function readJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
function isRecord2(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function packageVersionFromPackageJson(text) {
  const parsed = readJson(text);
  if (!isRecord2(parsed))
    return {};
  const record = parsed;
  const packageInfo = {};
  if (typeof record.name === "string")
    packageInfo.name = record.name;
  if (typeof record.version === "string")
    packageInfo.version = record.version;
  return packageInfo;
}
function malformedPackageJsonFinding(file) {
  if (isRecord2(readJson(file.text)))
    return null;
  return {
    id: `finding_${stableId(`${file.path}:malformed`)}`,
    kind: "package_manifest",
    severity: "critical",
    path: file.path,
    pattern: "package.json",
    message: "package.json must be valid JSON object before no-cloud dependency checks can pass",
    evidenceRefs: []
  };
}
function missingPackageJsonFinding() {
  return {
    id: "finding_package_manifest_missing",
    kind: "package_manifest",
    severity: "critical",
    pattern: "package.json",
    message: "No-cloud scan target must include a package.json manifest",
    evidenceRefs: []
  };
}
function dependencyFindings(file) {
  const parsed = readJson(file.text);
  if (!isRecord2(parsed)) {
    const malformed = malformedPackageJsonFinding(file);
    return malformed ? [malformed] : [];
  }
  const pkg = parsed;
  const packageName = typeof pkg.name === "string" ? pkg.name : undefined;
  const findings = [];
  if (packageName && FORBIDDEN_SHARED_CLOUD_RUNTIMES.includes(packageName)) {
    findings.push({
      id: `finding_${stableId(`${file.path}:name:${packageName}`)}`,
      kind: "package_manifest",
      severity: "critical",
      path: file.path,
      packageName,
      pattern: packageName,
      message: "Package identity is a forbidden shared cloud runtime",
      evidenceRefs: []
    });
  }
  for (const edge of manifestEdges(pkg, FORBIDDEN_SHARED_CLOUD_RUNTIMES)) {
    findings.push({
      id: `finding_${stableId(`${file.path}:${edge.section}:${edge.packageName}`)}`,
      kind: "package_manifest",
      severity: edge.scope === "production" ? "critical" : "high",
      path: file.path,
      packageName,
      pattern: edge.packageName,
      message: `Forbidden shared cloud runtime dependency in ${edge.section}`,
      evidenceRefs: []
    });
  }
  return findings;
}
function isAppCloudManifestDocument(file) {
  if (!file.path.endsWith(".json"))
    return false;
  const parsed = readJson(file.text);
  return isRecord2(parsed) && parsed.schema === SCHEMA_IDS.appCloudManifest;
}
function pathFindings(file, severity) {
  const findings = [];
  for (const entry of RUNTIME_PATTERNS) {
    if (!file.path.includes(entry.pattern))
      continue;
    findings.push({
      id: `finding_${stableId(`${file.path}:path:${entry.pattern}`)}`,
      kind: "checkKind" in entry ? entry.checkKind : file.kind,
      severity,
      path: file.path,
      pattern: entry.pattern,
      message: `${entry.message} in path`,
      evidenceRefs: []
    });
  }
  return findings;
}
function textFindings(file, severity) {
  if (isAppCloudManifestDocument(file))
    return [];
  const masked = maskCommentsForPath(file.text, file.path);
  const guardTest = guardTestMentionsOnly(file, masked);
  const codeLike = file.kind === "source_import" || file.kind === "packed_artifact";
  const bareMentionText = withoutInlinedDeclarations(masked, file.path);
  const findings = [];
  for (const { pattern, kind, message } of RUNTIME_PATTERNS) {
    let reason = null;
    if (kind === "symbol" && codeLike) {
      const bound = MODULE_PATTERNS.some((module) => importedBindings(masked, module.pattern).has(pattern));
      if (bound)
        reason = "imported binding";
    } else if (kind === "module" && importsModule(masked, pattern)) {
      reason = "module import";
    } else if (!(guardTest && kind === "module") && bareMentionText.includes(pattern)) {
      reason = "source reference";
    }
    if (!reason)
      continue;
    findings.push({
      id: `finding_${stableId(`${file.path}:${pattern}`)}`,
      kind: file.kind,
      severity,
      path: file.path,
      pattern,
      message: `${message} (${reason})`,
      evidenceRefs: []
    });
  }
  return findings;
}
function edgeFinding(edge, path, kind, packageName) {
  const via = edge.path.length > 1 ? ` via ${edge.path.join(" -> ")}` : "";
  const where = edge.section ? ` (root ${edge.section})` : "";
  return {
    id: `finding_${stableId(`${path}:edge:${edge.scope}:${edge.packageName}`)}`,
    kind,
    severity: edge.scope === "production" ? "critical" : "high",
    path,
    ...packageName ? { packageName } : {},
    pattern: edge.packageName,
    message: `Forbidden shared cloud runtime is a reachable ${edge.scope} dependency${via}${where}`,
    evidenceRefs: []
  };
}
var BUN_LOCKFILE = "bun.lock";
function lockfileTextFindings(file, severity) {
  const findings = [];
  for (const { pattern, message } of LOCKFILE_TEXT_PATTERNS) {
    if (!file.text.includes(pattern))
      continue;
    findings.push({
      id: `finding_${stableId(`${file.path}:${pattern}`)}`,
      kind: file.kind,
      severity,
      path: file.path,
      pattern,
      message: `${message} (source reference)`,
      evidenceRefs: []
    });
  }
  return findings;
}
function lockfileUnwalkedNameFindings(file, severity, walk) {
  const explained = new Set([...walk.edges.map((edge) => edge.packageName), ...walk.clearedByLayout]);
  const findings = [];
  for (const { pattern, message } of MODULE_PATTERNS) {
    if (explained.has(pattern))
      continue;
    if (!lockfileNamesPackage(file.text, pattern))
      continue;
    findings.push({
      id: `finding_${stableId(`${file.path}:${pattern}`)}`,
      kind: file.kind,
      severity,
      path: file.path,
      pattern,
      message: `${message} (lockfile names it outside any edge the walk could read)`,
      evidenceRefs: []
    });
  }
  return findings;
}
function lockfileFindings(file, severity, packageName) {
  if (basename(file.path) !== BUN_LOCKFILE)
    return textFindings(file, severity);
  const walk = lockfileWalk(file.text, FORBIDDEN_LOCKFILE_PACKAGES);
  if (walk === null)
    return textFindings(file, severity);
  return [
    ...walk.edges.map((edge) => edgeFinding(edge, file.path, "lockfile", packageName)),
    ...lockfileUnwalkedNameFindings(file, severity, walk),
    ...lockfileTextFindings(file, severity)
  ];
}
function scanFindings(file, severity, packageName) {
  if (file.kind === "package_manifest") {
    return [...dependencyFindings(file), ...pathFindings(file, severity), ...textFindings(file, "high")];
  }
  if (file.kind === "lockfile") {
    return [...pathFindings(file, severity), ...lockfileFindings(file, severity, packageName)];
  }
  return [...pathFindings(file, severity), ...textFindings(file, severity)];
}
function shouldReadPath(path) {
  for (const entry of PATH_CONFIG_PATTERNS) {
    if (path.includes(entry.pattern))
      return entry.checkKind;
  }
  const name = basename(path);
  if (name === "package.json")
    return "package_manifest";
  if (LOCKFILES.has(name))
    return "lockfile";
  if (name === ".env" || name.startsWith(".env."))
    return "runtime_config";
  if (!/\.(cjs|cts|js|json|jsx|mjs|mts|sh|ts|tsx|toml|ya?ml)$/i.test(name))
    return null;
  const parts = path.split(/[\\/]/);
  if (parts.length === 1)
    return "source_import";
  return parts.some((part) => SOURCE_DIRS.has(part)) ? "source_import" : null;
}
function collectDirectoryFiles(root) {
  const files = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join2(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name))
          walk(full);
        continue;
      }
      if (!entry.isFile())
        continue;
      const kind = shouldReadPath(relative(root, full).replaceAll("\\", "/"));
      if (!kind)
        continue;
      const stat = statSync(full);
      if (stat.size > MAX_TEXT_BYTES)
        continue;
      files.push({ path: relative(root, full).replaceAll("\\", "/"), text: readFileSync(full, "utf8"), kind });
    }
  }
  walk(root);
  return files;
}
function collectTarballFiles(target) {
  const entries = listArchiveEntries(target);
  const archiveRoot = commonArchiveRoot(entries);
  const files = [];
  for (const entry of entries) {
    const normalized = normalizeArchiveEntry(entry, archiveRoot);
    if (!normalized)
      continue;
    const kind = shouldReadPath(normalized);
    if (!kind)
      continue;
    let text;
    try {
      text = readArchiveMemberText(target, entry);
    } catch (error2) {
      if (error2 instanceof Error && (error2.code === "ENOBUFS" || error2.message.includes("maxBuffer"))) {
        continue;
      }
      throw error2;
    }
    const artifactKind = kind === "package_manifest" || kind === "lockfile" ? kind : "packed_artifact";
    files.push({ path: normalized, text, kind: artifactKind });
  }
  return files;
}
function collectScanFiles(target) {
  const stat = statSync(target);
  if (stat.isDirectory())
    return { files: collectDirectoryFiles(target), scanMode: "source_tree" };
  if (stat.isFile() && isPackedArtifactPath(target))
    return { files: collectTarballFiles(target), scanMode: "packed_artifact" };
  throw new Error("no-cloud scan target must be a directory, .tgz, or .tar.gz file");
}
function portableSubject(resolved, scanMode, packageName) {
  if (scanMode === "packed_artifact") {
    const artifactName = basename(resolved);
    return {
      kind: "artifact",
      id: artifactName,
      uri: `artifact://${artifactName}`
    };
  }
  const repoId = packageName ?? basename(resolved);
  return {
    kind: "repo",
    id: repoId,
    uri: `repo://${repoId}`
  };
}
function scanNoCloudTarget(target, options = {}) {
  const resolved = resolve2(target);
  const { files, scanMode } = collectScanFiles(resolved);
  const packageFile = files.find((file) => file.path === "package.json") ?? files.find((file) => file.path.endsWith("/package.json"));
  const packageInfo = packageFile ? packageVersionFromPackageJson(packageFile.text) : {};
  const subject = portableSubject(resolved, scanMode, packageInfo.name);
  const targetRef = (checkId) => `${subject.uri}#${checkId}`;
  const findings = files.flatMap((file) => {
    if (file.kind === "lockfile")
      return scanFindings(file, "high", packageInfo.name);
    if (file.kind === "packed_artifact")
      return scanFindings(file, "critical", packageInfo.name);
    return scanFindings(file, "high", packageInfo.name);
  });
  const manifestProvided = Object.prototype.hasOwnProperty.call(options, "manifest") && options.manifest !== undefined;
  const manifestResult = manifestProvided ? AppCloudManifestSchema.safeParse(options.manifest) : null;
  const manifestFindings = [];
  if (manifestResult && !manifestResult.success) {
    manifestFindings.push({
      id: "finding_app_cloud_manifest_invalid",
      kind: "app_cloud_manifest",
      severity: "critical",
      pattern: SCHEMA_IDS.appCloudManifest,
      message: manifestResult.error.issues.map((issue2) => `${issue2.path.join(".") || "<root>"}: ${issue2.message}`).join("; "),
      evidenceRefs: []
    });
  }
  if (manifestResult?.success && packageInfo.name && manifestResult.data.packageName !== packageInfo.name) {
    manifestFindings.push({
      id: "finding_app_cloud_manifest_package_mismatch",
      kind: "app_cloud_manifest",
      severity: "critical",
      pattern: "packageName",
      message: `App cloud manifest packageName ${manifestResult.data.packageName} does not match scanned package ${packageInfo.name}`,
      evidenceRefs: []
    });
  }
  if (manifestResult?.success && packageInfo.version && manifestResult.data.packageVersion && manifestResult.data.packageVersion !== packageInfo.version) {
    manifestFindings.push({
      id: "finding_app_cloud_manifest_version_mismatch",
      kind: "app_cloud_manifest",
      severity: "high",
      pattern: "packageVersion",
      message: `App cloud manifest packageVersion ${manifestResult.data.packageVersion} does not match scanned package ${packageInfo.version}`,
      evidenceRefs: []
    });
  }
  const packagePresenceFindings = packageFile ? [] : [missingPackageJsonFinding()];
  const allFindings = [...packagePresenceFindings, ...findings, ...manifestFindings];
  const status = allFindings.some((finding) => finding.severity === "high" || finding.severity === "critical") ? "failed" : "succeeded";
  const packageChecks = [...packagePresenceFindings, ...files.filter((file) => file.kind === "package_manifest").flatMap((file) => scanFindings(file, "high", packageInfo.name))];
  const lockChecks = files.filter((file) => file.kind === "lockfile").flatMap((file) => scanFindings(file, "high", packageInfo.name));
  const sourceChecks = files.filter((file) => file.kind === "source_import" || file.kind === "runtime_config").flatMap((file) => scanFindings(file, "high", packageInfo.name));
  const artifactChecks = files.filter((file) => file.kind === "packed_artifact").flatMap((file) => scanFindings(file, "critical", packageInfo.name));
  const checks3 = [
    {
      id: "package_manifest",
      kind: "package_manifest",
      status: packageChecks.length > 0 ? "failed" : "succeeded",
      target: targetRef("package_manifest"),
      findings: packageChecks,
      evidenceRefs: []
    },
    {
      id: "lockfile",
      kind: "lockfile",
      status: lockChecks.length > 0 ? "failed" : "succeeded",
      target: targetRef("lockfile"),
      findings: lockChecks,
      evidenceRefs: []
    },
    {
      id: "source_runtime",
      kind: scanMode === "packed_artifact" ? "packed_artifact" : "source_import",
      status: sourceChecks.length + artifactChecks.length > 0 ? "failed" : "succeeded",
      target: targetRef("source_runtime"),
      findings: [...sourceChecks, ...artifactChecks],
      evidenceRefs: []
    }
  ];
  if (manifestProvided) {
    checks3.push({
      id: "app_cloud_manifest",
      kind: "app_cloud_manifest",
      status: manifestResult?.success && manifestFindings.length === 0 ? "succeeded" : "failed",
      target: targetRef("app_cloud_manifest"),
      findings: manifestFindings,
      evidenceRefs: []
    });
  }
  return NoCloudEvidencePackSchema.parse({
    schema: SCHEMA_IDS.noCloudEvidencePack,
    id: options.id ?? `no_cloud_${stableId(`${subject.uri}:${packageInfo.version ?? ""}`)}`,
    createdAt: options.now ?? new Date().toISOString(),
    subject,
    packageName: packageInfo.name,
    packageVersion: packageInfo.version,
    generatedBy: options.generatedBy,
    scanMode,
    status,
    verdict: status === "succeeded" ? "passed" : "failed",
    appCloudManifest: manifestResult?.success ? manifestResult.data : undefined,
    checks: checks3,
    findings: allFindings
  });
}

// src/conformance.ts
import { existsSync as existsSync2, readFileSync as readFileSync4, statSync as statSync3 } from "fs";
import { join as join5, relative as relative3 } from "path";

// src/service-contract.ts
import { readFileSync as readFileSync2 } from "fs";
import { join as join3 } from "path";

// src/env-token.ts
function envToken(name) {
  return name.toUpperCase().replace(/-/g, "_");
}

// src/server-backend.ts
function serverDataBackendEnvKeys(name) {
  const token = envToken(name);
  return {
    databaseUrlKeys: [`HASNA_${token}_DATABASE_URL`, `${token}_DATABASE_URL`]
  };
}
function definedDatabaseUrlEntries(env, keys) {
  return keys.filter((key) => Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined).map((key) => ({ key, value: String(env[key]) }));
}
function assertPostgresqlDatabaseUrl(name, entries) {
  const canonicalKey = serverDataBackendEnvKeys(name).databaseUrlKeys[0];
  if (entries.length === 0) {
    throw new Error(`${canonicalKey} is required; Hasna servers use authoritative PostgreSQL and never default to SQLite.`);
  }
  const blank2 = entries.filter((entry) => entry.value.trim().length === 0);
  if (blank2.length > 0) {
    throw new Error(`${blank2.map((entry) => entry.key).join(" and ")} is set but blank; a PostgreSQL database URL is required.`);
  }
  const controlled = entries.find((entry) => /[\u0000-\u001f\u007f]/.test(entry.value));
  if (controlled)
    throw new Error(`${controlled.key} must not contain ASCII control characters.`);
  const normalized = entries.map((entry) => ({ key: entry.key, value: entry.value.trim() }));
  if (normalized.length > 1 && new Set(normalized.map((entry) => entry.value)).size > 1) {
    throw new Error(`${normalized.map((entry) => entry.key).join(" and ")} disagree; database URL aliases must be identical or only one may be set.`);
  }
  const selected = normalized[0];
  let parsed;
  try {
    parsed = new URL(selected.value);
  } catch {
    throw new Error(`${selected.key} must be an absolute PostgreSQL connection URL.`);
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`${selected.key} must use the postgres or postgresql scheme.`);
  }
  if (!parsed.hostname || parsed.pathname.length <= 1) {
    throw new Error(`${selected.key} must name a PostgreSQL host and database.`);
  }
  return selected;
}
function resolveServerDataBackend(name, env = process.env) {
  const { databaseUrlKeys } = serverDataBackendEnvKeys(name);
  const databaseUrl = assertPostgresqlDatabaseUrl(name, definedDatabaseUrlEntries(env, databaseUrlKeys));
  return {
    backend: "postgresql",
    source: databaseUrl.key,
    databaseUrlPresent: true,
    databaseUrlSource: databaseUrl.key
  };
}

// src/service-contract.ts
var SERVICE_CONTRACT_MANIFEST_FILENAME = "hasna.contract.json";
var WAIVER_TEXT_JSON_SCHEMA_PATTERN = "^[^\\u0000-\\u001f\\u007f]*$";
var SERVICE_CONTRACT_JSON_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://github.com/hasna/contracts/schema/hasna.service_contract.v1.json",
  title: "Hasna Service Contract v1",
  description: "Repo self-description (hasna.contract.json) for the Hasna Service Contract v1. Public clients use one authenticated HTTPS service transport; authoritative server data is PostgreSQL.",
  type: "object",
  additionalProperties: false,
  required: ["schema", "name", "class", "contractVersion", "kitVersion"],
  allOf: [
    {
      if: {
        required: ["class"],
        properties: {
          class: { const: "saas" }
        }
      },
      then: {
        required: ["storage"],
        properties: {
          storage: {
            required: ["backend", "envPrefix"],
            properties: {
              backend: { const: "postgresql" }
            }
          }
        }
      }
    }
  ],
  properties: {
    $schema: { type: "string", description: "Optional editor hint pointing at this JSON Schema." },
    schema: { const: SCHEMA_IDS.serviceContract },
    name: {
      type: "string",
      pattern: "^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$",
      description: "Lowercase dashed app short-name, e.g. todos, mailery, loops."
    },
    class: { enum: ["library", "cli-with-store", "service", "saas"] },
    contractVersion: { const: "v1" },
    kitVersion: {
      type: "string",
      minLength: 1,
      description: "Version of @hasna/contracts (the contract kit) the repo tracks."
    },
    description: { type: "string", minLength: 1 },
    bins: {
      type: "array",
      items: { type: "string", minLength: 1 },
      description: "Declared bins. Allowlisted: <name>, <name>-cli, <name>-mcp, <name>-serve, <name>-worker, <name>-runner, <name>-daemon, <name>-migrate, <name>-doctor. The deployment app additionally supports its registered canonical operator entrypoint hasna-deploy."
    },
    hosting: {
      type: "array",
      items: { enum: ["user-hosted", "hasna-saas"] },
      minItems: 1,
      uniqueItems: true,
      description: "Customer-facing product stories. Public OSS cores include user-hosted; add hasna-saas only when a managed control plane exists."
    },
    serviceSurfaces: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "status", "authMode"],
        allOf: [
          {
            if: {
              required: ["status"],
              properties: {
                status: { const: "supported" },
                kind: { const: "api" }
              }
            },
            then: {
              required: ["bin", "health", "readiness", "version"]
            }
          }
        ],
        properties: {
          name: { type: "string", minLength: 1 },
          kind: { enum: ["api", "sdk", "mcp", "cli"] },
          status: { enum: ["supported", "deferred", "unsupported"] },
          bin: { type: "string", minLength: 1 },
          mcpBin: { type: "string", minLength: 1 },
          authMode: { enum: ["none", "local-only", "api-key", "session", "service-token", "custom"] },
          health: {
            type: "object",
            additionalProperties: false,
            required: ["method", "path"],
            properties: {
              method: { const: "GET" },
              path: { type: "string", pattern: "^/[A-Za-z0-9_./:*-]*$" },
              public: { type: "boolean" },
              description: { type: "string", minLength: 1 }
            }
          },
          readiness: {
            type: "object",
            additionalProperties: false,
            required: ["method", "path"],
            properties: {
              method: { const: "GET" },
              path: { type: "string", pattern: "^/[A-Za-z0-9_./:*-]*$" },
              public: { type: "boolean" },
              description: { type: "string", minLength: 1 }
            }
          },
          version: {
            type: "object",
            additionalProperties: false,
            required: ["method", "path"],
            properties: {
              method: { const: "GET" },
              path: { type: "string", pattern: "^/[A-Za-z0-9_./:*-]*$" },
              public: { type: "boolean" },
              description: { type: "string", minLength: 1 }
            }
          },
          apiBasePath: { type: "string", pattern: "^/v[0-9]+$" },
          openApiPath: { type: "string", pattern: "^/[A-Za-z0-9_./:-]*$" },
          exportSubpath: {
            type: "string",
            pattern: "^\\.(?:\\/[A-Za-z0-9_.-]+(?:\\/[A-Za-z0-9_.-]+)*)?$",
            description: "SDK package export key such as . or ./sdk."
          },
          generatedFrom: {
            type: "string",
            pattern: "^/[A-Za-z0-9_./:-]*$",
            description: "OpenAPI path used to generate the SDK."
          },
          clientClassName: {
            type: "string",
            pattern: "^[A-Za-z_$][A-Za-z0-9_$]*$"
          },
          deferReason: { type: "string", minLength: 1 },
          readinessGates: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "kind"],
              properties: {
                id: { type: "string", minLength: 1 },
                kind: {
                  enum: ["auth", "storage", "secret-ref", "migration", "health", "readiness", "redaction", "smoke", "operator", "other"]
                },
                required: { type: "boolean" },
                command: { type: "string", minLength: 1 },
                evidenceRef: { type: "object" },
                status: { enum: ["pending", "passed", "failed", "blocked", "deferred"] },
                summary: { type: "string", minLength: 1 }
              }
            }
          }
        }
      },
      description: "Declared API, SDK, MCP, and CLI product surfaces. Legacy entries without kind remain parseable; new manifests declare kind explicitly."
    },
    storage: {
      type: "object",
      additionalProperties: false,
      required: ["backend"],
      properties: {
        backend: {
          enum: ["sqlite", "postgresql"],
          description: "Manifested runtime/migration capability. Server startup still requires PostgreSQL; SQLite is legacy import input only."
        },
        engines: {
          type: "array",
          items: { enum: ["sqlite", "json", "postgresql"] },
          minItems: 1,
          uniqueItems: true,
          description: "Supported storage engines; capability metadata independent of the active backend."
        },
        envPrefix: {
          type: "string",
          pattern: "^HASNA_[A-Z][A-Z0-9]*_$",
          description: "Primary env prefix, e.g. HASNA_TODOS_."
        },
        aliasEnvPrefix: {
          type: "string",
          pattern: "^[A-Z][A-Z0-9]*_$",
          description: "Optional short alias env prefix, e.g. TODOS_."
        },
        databaseUrlSecretRef: {
          type: "string",
          pattern: "^hasna/oss/[a-z0-9-]+/database-url$",
          description: "Legacy/private-tier database secret ref. Public conformance rejects this field."
        },
        sqlitePath: {
          type: "string",
          pattern: "\\.db$",
          description: "Explicit legacy SQLite import path; never a live client/server store."
        },
        pgTestGate: {
          type: "object",
          additionalProperties: false,
          required: ["envVar", "command"],
          properties: {
            envVar: {
              type: "string",
              pattern: "^[A-Z][A-Z0-9_]*_TEST_DATABASE_URL$"
            },
            command: { type: "string", minLength: 1 }
          },
          description: "Environment-gated live PostgreSQL test command."
        }
      }
    },
    publishing: {
      type: "object",
      additionalProperties: false,
      required: ["status"],
      allOf: [
        {
          if: {
            required: ["status"],
            properties: { status: { const: "published" } }
          },
          then: {
            required: ["targets"],
            properties: { targets: { minItems: 1 } }
          }
        },
        {
          if: {
            required: ["status"],
            properties: { status: { const: "unpublished" } }
          },
          then: {
            properties: { targets: { maxItems: 0 } }
          }
        }
      ],
      properties: {
        status: {
          enum: ["published", "unpublished"],
          description: "Whether the repo ships a published artifact. Declaring unpublished is a positive statement; omitting publishing entirely says only that the repo has not described how it ships."
        },
        targets: {
          type: "array",
          uniqueItems: true,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["package", "registry", "mechanism", "credential"],
            allOf: [
              {
                if: {
                  required: ["mechanism"],
                  properties: { mechanism: { const: "ci" } }
                },
                then: { required: ["workflow"] }
              },
              {
                if: {
                  required: ["mechanism"],
                  properties: { mechanism: { const: "manual" } }
                },
                then: { not: { required: ["workflow"] } }
              },
              {
                if: {
                  required: ["credential"],
                  properties: { credential: { const: "trusted-publisher" } }
                },
                then: { properties: { mechanism: { const: "ci" } } }
              }
            ],
            properties: {
              package: {
                type: "string",
                pattern: "^(?:@[a-z0-9][a-z0-9._-]*\\/)?[a-z0-9][a-z0-9._-]*$",
                description: "Registry package name including any scope, e.g. @hasna/todos."
              },
              registry: {
                type: "string",
                pattern: "^[a-z0-9][a-z0-9.-]*(?::[0-9]+)?(?:\\/[A-Za-z0-9._~-]+)*$",
                description: "Registry host, optionally with port and path, and never a scheme or embedded credentials (registry.npmjs.org, npm.pkg.github.com). No registry is assumed by default."
              },
              access: {
                enum: ["public", "restricted"],
                description: "Registry visibility of the published artifact."
              },
              mechanism: {
                enum: ["ci", "manual"],
                description: "Where the publish is initiated and authorised from. Not a taxonomy of publish commands: a repo publishing through a bespoke script is still ci when a workflow drives it."
              },
              credential: {
                enum: ["trusted-publisher", "token"],
                description: "How the publish authenticates. trusted-publisher is workload identity exchanged at publish time; token is a long-lived registry credential."
              },
              flow: {
                enum: ["direct", "staged"],
                description: "Whether the artifact becomes installable in one step, or is uploaded first and promoted in a separate step."
              },
              provenance: {
                enum: ["required", "best-effort", "none"],
                description: "Intent for build provenance/attestation. required means the release gate refuses a publish without it."
              },
              workflow: {
                type: "object",
                additionalProperties: false,
                required: ["provider", "repository", "file"],
                properties: {
                  provider: {
                    enum: ["github-actions", "gitlab-ci"],
                    description: "CI provider the registry accepts as a trusted publisher."
                  },
                  repository: {
                    type: "string",
                    pattern: "^[A-Za-z0-9._-]+\\/[A-Za-z0-9._-]+$",
                    description: "owner/repo on the provider's forge."
                  },
                  file: {
                    type: "string",
                    pattern: "^[A-Za-z0-9._-]+\\.ya?ml$",
                    description: "Workflow file NAME, not a path; registries key the registration on the bare filename."
                  },
                  environment: {
                    type: "string",
                    minLength: 1,
                    description: "Deployment environment gating the publish job. Absent means no environment gate, not unknown."
                  }
                },
                description: "The exact triple a registry's trusted-publisher registration consumes."
              }
            }
          },
          description: "One entry per published artifact per registry. A repo shipping several packages declares one target each."
        }
      },
      description: "How the repo's artifacts reach consumers. Optional and additive; absence asserts nothing."
    },
    metadata: {
      type: "object",
      additionalProperties: true,
      properties: {
        conformance: {
          type: "object",
          additionalProperties: true,
          properties: {
            waiverProfile: {
              const: "non-node-monorepo",
              description: "Explicit surface-waiver eligibility for exceptional non-Node monorepos. Libraries are eligible for API/MCP waivers without this profile."
            },
            waivedSurfaces: {
              type: "array",
              uniqueItems: true,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["kind", "reason"],
                properties: {
                  kind: { enum: ["api", "sdk", "mcp", "cli"] },
                  reason: { type: "string", minLength: 1 }
                }
              }
            },
            waivedStorageEngines: {
              type: "array",
              uniqueItems: true,
              maxItems: WAIVABLE_STORAGE_ENGINES.length,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["engine", "reason"],
                properties: {
                  engine: { enum: [...WAIVABLE_STORAGE_ENGINES] },
                  reason: {
                    type: "string",
                    minLength: 1,
                    maxLength: STORAGE_WAIVER_REASON_MAX_LENGTH,
                    allOf: [{ pattern: "\\S" }, { pattern: WAIVER_TEXT_JSON_SCHEMA_PATTERN }]
                  },
                  reviewedBy: {
                    type: "string",
                    minLength: 1,
                    maxLength: STORAGE_WAIVER_REVIEWER_MAX_LENGTH,
                    allOf: [{ pattern: "\\S" }, { pattern: WAIVER_TEXT_JSON_SCHEMA_PATTERN }]
                  },
                  expiresAt: { type: "string", format: "date-time" }
                }
              },
              description: "Explicit storage-engine exceptions, at most one per engine. Only a CLI-only cli-with-store repo (no <name>-serve bin, no supported api service surface, storage.backend sqlite, no hasna-saas story) may waive postgresql; sqlite is never waivable, expiresAt is a UTC RFC 3339 timestamp, and conformance stops honouring a waiver once it has passed."
            }
          }
        }
      }
    }
  }
};
function validateServiceContractManifest(value) {
  return ServiceContractManifestSchema.safeParse(value);
}
function loadServiceContractManifest(repoRoot) {
  const path = join3(repoRoot, SERVICE_CONTRACT_MANIFEST_FILENAME);
  let raw;
  try {
    raw = readFileSync2(path, "utf8");
  } catch (error2) {
    const message = error2 instanceof Error ? error2.message : String(error2);
    return { ok: false, path, error: `Could not read ${SERVICE_CONTRACT_MANIFEST_FILENAME}: ${message}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error2) {
    const message = error2 instanceof Error ? error2.message : String(error2);
    return { ok: false, path, error: `Invalid JSON in ${SERVICE_CONTRACT_MANIFEST_FILENAME}: ${message}` };
  }
  const result = validateServiceContractManifest(parsed);
  if (!result.success) {
    return { ok: false, path, error: "Service contract manifest failed validation", issues: result.error.issues };
  }
  return { ok: true, manifest: result.data, path };
}

// src/auth/keys.ts
import { createHash as createHash3, createHmac, randomBytes, timingSafeEqual } from "crypto";

// src/auth/scopes.ts
var SCOPE_PART = /^(?:\*|[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*)$/;
function isValidScope(scope) {
  if (scope === "*")
    return true;
  const idx = scope.indexOf(":");
  if (idx <= 0 || idx === scope.length - 1)
    return false;
  const app = scope.slice(0, idx);
  const action = scope.slice(idx + 1);
  return SCOPE_PART.test(app) && SCOPE_PART.test(action);
}

// src/auth/tenant.ts
var MAX_TENANT_ID_LENGTH = 64;
var TENANT_ID_PATTERN = new RegExp(`^[A-Za-z0-9][A-Za-z0-9._-]{0,${MAX_TENANT_ID_LENGTH - 1}}$`);
var UUID_HEX = "[0-9a-fA-F]";
var UUID_PATTERN = new RegExp(`^\\{?(?:${UUID_HEX}{8}-${UUID_HEX}{4}-${UUID_HEX}{4}-${UUID_HEX}{4}-${UUID_HEX}{12}|${UUID_HEX}{32})\\}?$`);
function isValidTenantId(value) {
  return typeof value === "string" && TENANT_ID_PATTERN.test(value);
}
function isUuidTenantId(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
function canonicalizeTenantId(value) {
  if (!isUuidTenantId(value))
    return value;
  const hex = value.replace(/[{}-]/g, "").toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function normalizeTenantId(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  const canonical = canonicalizeTenantId(trimmed);
  if (!isValidTenantId(canonical)) {
    throw new Error(`Invalid tenant id '${value}'. Expected 1-${MAX_TENANT_ID_LENGTH} characters matching ${TENANT_ID_PATTERN} (a UUID, ULID, slug, or prefixed id).`);
  }
  return canonical;
}
function ownTenantId(source) {
  return Object.hasOwn(source, "tid") ? source.tid : undefined;
}

// src/auth/keys.ts
var API_KEY_TOKEN_VERSION = 1;
var API_KEY_NAMESPACE = "hasna";
var APP_SLUG_PATTERN = /^[a-z][a-z0-9-]*$/;
var API_KEY_TOKEN_PATTERN = /^hasna_([a-z][a-z0-9-]*)_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;
var DEFAULT_API_KEY_TTL_SECONDS = 90 * 24 * 60 * 60;
function ownAgentClaim(source) {
  return Object.hasOwn(source, "agent") && typeof source.agent === "string" ? source.agent : null;
}
function ownOption(options, name) {
  return Object.hasOwn(options, name) ? options[name] : undefined;
}
function base64urlEncode(input) {
  return Buffer.from(input).toString("base64url");
}
function describeType(value) {
  if (value === null)
    return "null";
  if (value === undefined)
    return "undefined";
  const name = value?.constructor?.name;
  return name ? `${typeof value} (${name})` : typeof value;
}
function isBinarySecret(value) {
  return ArrayBuffer.isView(value) || value instanceof ArrayBuffer;
}
var typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
var intrinsicViewBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer").get;
var intrinsicViewByteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset").get;
var intrinsicViewByteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength").get;
var intrinsicDataViewBuffer = Object.getOwnPropertyDescriptor(DataView.prototype, "buffer").get;
var intrinsicDataViewByteOffset = Object.getOwnPropertyDescriptor(DataView.prototype, "byteOffset").get;
var intrinsicDataViewByteLength = Object.getOwnPropertyDescriptor(DataView.prototype, "byteLength").get;
function viewWindow(view) {
  try {
    return [
      intrinsicViewBuffer.call(view),
      intrinsicViewByteOffset.call(view),
      intrinsicViewByteLength.call(view)
    ];
  } catch {
    return [
      intrinsicDataViewBuffer.call(view),
      intrinsicDataViewByteOffset.call(view),
      intrinsicDataViewByteLength.call(view)
    ];
  }
}
function toBuffer(secret) {
  if (typeof secret === "string")
    return Buffer.from(secret.trim(), "utf8");
  if (ArrayBuffer.isView(secret)) {
    const [store, byteOffset, byteLength] = viewWindow(secret);
    return Buffer.from(store, byteOffset, byteLength);
  }
  return Buffer.from(secret);
}
function hmac(signingSecret, message) {
  return createHmac("sha256", toBuffer(signingSecret)).update(message, "utf8").digest();
}
function hashToken(token) {
  return createHash3("sha256").update(token, "utf8").digest("hex");
}
function apiKeyPrefix(app) {
  return `${API_KEY_NAMESPACE}_${app}_`;
}
function generateKid(bytes = 8) {
  return randomBytes(bytes).toString("hex");
}
function mintApiKey(options) {
  const requestedApp = ownOption(options, "app");
  const requestedScopes = ownOption(options, "scopes");
  const requestedSecret = ownOption(options, "signingSecret");
  const requestedKid = ownOption(options, "kid");
  const requestedNowMs = ownOption(options, "nowMs");
  const requestedTtlSeconds = ownOption(options, "ttlSeconds");
  const requestedTid = ownTenantId(options);
  const agent = ownAgentClaim(options);
  if (typeof requestedApp !== "string") {
    throw new Error(`app must be a string; received ${describeType(requestedApp)}. Expected a slug matching ${APP_SLUG_PATTERN}.`);
  }
  const app = requestedApp.trim();
  if (!APP_SLUG_PATTERN.test(app)) {
    throw new Error(`Invalid app slug '${requestedApp}'. Expected ${APP_SLUG_PATTERN}.`);
  }
  if (!Array.isArray(requestedScopes) || requestedScopes.length === 0) {
    throw new Error("At least one scope is required to mint an API key.");
  }
  for (const scope of requestedScopes) {
    if (!isValidScope(scope)) {
      throw new Error(`Invalid scope '${scope}'. Expected '*' or '<app>:<action>'.`);
    }
  }
  if (typeof requestedSecret !== "string" && !isBinarySecret(requestedSecret)) {
    throw new Error("signingSecret must be a string, Buffer, TypedArray, DataView, or ArrayBuffer; " + `received ${describeType(requestedSecret)}.`);
  }
  const secret = toBuffer(requestedSecret);
  if (secret.length < 16) {
    throw new Error("signingSecret must be at least 16 bytes of entropy.");
  }
  const kid = requestedKid ?? generateKid();
  if (!/^[A-Za-z0-9_-]+$/.test(kid)) {
    throw new Error(`Invalid kid '${kid}'. Expected url-safe characters only.`);
  }
  const tid = requestedTid === undefined ? undefined : normalizeTenantId(requestedTid);
  const nowMs = requestedNowMs ?? Date.now();
  const iat = Math.floor(nowMs / 1000);
  const ttl = requestedTtlSeconds === undefined ? DEFAULT_API_KEY_TTL_SECONDS : requestedTtlSeconds;
  if (ttl !== null && (!Number.isFinite(ttl) || ttl <= 0)) {
    throw new Error("ttlSeconds must be a positive number or null (no expiry).");
  }
  const exp = ttl === null ? null : iat + Math.floor(ttl);
  const claims = {
    v: API_KEY_TOKEN_VERSION,
    kid,
    app,
    ...tid !== undefined ? { tid } : {},
    scopes: [...requestedScopes],
    iat,
    exp,
    ...agent !== null ? { agent } : {}
  };
  const body = base64urlEncode(JSON.stringify(claims));
  const signingInput = `${apiKeyPrefix(app)}${body}`;
  const sig = base64urlEncode(hmac(secret, signingInput));
  const token = `${signingInput}.${sig}`;
  return {
    token,
    kid,
    claims,
    tokenHash: hashToken(token),
    prefix: apiKeyPrefix(app)
  };
}

// src/credential-seam.ts
import { readFileSync as readFileSync3, readdirSync as readdirSync2, statSync as statSync2 } from "fs";
import { join as join4, relative as relative2 } from "path";

// src/client/env-keys.ts
function clientTransportEnvKeys(name) {
  const envSegment = envToken(name);
  return {
    apiUrlKeys: [`HASNA_${envSegment}_API_URL`, `${envSegment}_API_URL`],
    apiKeyKeys: [`HASNA_${envSegment}_API_KEY`, `${envSegment}_API_KEY`]
  };
}

// src/credential-seam.ts
var SKIP_DIRS2 = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "bin",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
  "tests",
  "test",
  "__tests__",
  "examples",
  "docs",
  "scripts"
]);
var INBOUND_SURFACE_DIRS = new Set(["server", "http", "api", "mcp"]);
function isInboundSurfacePath(path) {
  const segments = path.split("/");
  return segments.length > 2 && segments[0] === "src" && INBOUND_SURFACE_DIRS.has(segments[1]);
}
var SOURCE_EXTENSIONS = /\.(?:[cm]?ts|[cm]?js|tsx|jsx)$/i;
var TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/i;
var MAX_FILE_BYTES = 2000000;
var WAIVER_MARKER = /hasna-credential-seam-waiver:\s*(.+)$/i;
var MIN_WAIVER_REASON_LENGTH = 12;
var EMPTY_REASONS = /^(?:todo|fixme|wip|n\/?a|later|temporary|temp|because|reasons?|legacy)\W*$/i;
var FOREIGN_CLIENT_KEY = /^HASNA_[A-Z0-9]+_API_KEY$/;
function maskComments2(text) {
  const masked = [];
  let inBlockComment = false;
  for (const line of text.split(`
`)) {
    const out = line.split("");
    let quote = null;
    let index = 0;
    while (index < line.length) {
      const char = line[index];
      const next = line[index + 1];
      if (inBlockComment) {
        if (char === "*" && next === "/") {
          out[index] = " ";
          out[index + 1] = " ";
          index += 2;
          inBlockComment = false;
          continue;
        }
        out[index] = " ";
        index += 1;
        continue;
      }
      if (quote) {
        if (char === "\\") {
          index += 2;
          continue;
        }
        if (char === quote)
          quote = null;
        index += 1;
        continue;
      }
      if (char === '"' || char === "'" || char === "`") {
        quote = char;
        index += 1;
        continue;
      }
      if (char === "/" && next === "/") {
        while (index < line.length) {
          out[index] = " ";
          index += 1;
        }
        continue;
      }
      if (char === "/" && next === "*") {
        out[index] = " ";
        out[index + 1] = " ";
        index += 2;
        inBlockComment = true;
        continue;
      }
      index += 1;
    }
    masked.push(out.join(""));
  }
  return masked.join(`
`);
}
function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function readPatterns(variable) {
  const name = escapeForRegExp(variable);
  return [
    new RegExp(`\\.${name}\\b(?!\\s*=(?!=))`, "g"),
    new RegExp(`[\\w$)\\]]\\s*\\[\\s*(['"\`])${name}\\1\\s*\\](?!\\s*=(?!=))`, "g"),
    new RegExp(`\\{[^{}]*\\b${name}\\b[^{}]*\\}\\s*=\\s*[\\w$.]*\\benv\\b`, "g")
  ];
}
var COMPUTED_CLIENT_KEY_READ = /[\w$)\]]\s*\[\s*`HASNA_\$\{[^`]*\}_API_KEY`\s*\]/g;
var SEAM_DEFINITION = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?(?:function\s+|const\s+|let\s+|var\s+)(resolveClientTransport|createClientTransport|createHasnaHttpTransport|resolveStorageClient)\s*(?:\(|=\s*(?:async\s*)?(?:\(|function))/g;
function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0;i < index && i < text.length; i += 1) {
    if (text[i] === `
`)
      line += 1;
  }
  return line;
}
function packageName(repoRoot) {
  try {
    const pkg = JSON.parse(readFileSync3(join4(repoRoot, "package.json"), "utf8"));
    return typeof pkg.name === "string" ? pkg.name : null;
  } catch {
    return null;
  }
}
function collectSourceFiles(root) {
  const files = [];
  function walk(dir) {
    let entries;
    try {
      entries = readdirSync2(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join4(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS2.has(entry.name))
          walk(full);
        continue;
      }
      if (!entry.isFile())
        continue;
      if (!SOURCE_EXTENSIONS.test(entry.name) || TEST_FILE.test(entry.name))
        continue;
      try {
        if (statSync2(full).size > MAX_FILE_BYTES)
          continue;
      } catch {
        continue;
      }
      files.push(full);
    }
  }
  walk(root);
  return files;
}
function scanCredentialSeam(repoRoot, options) {
  const ownKeys = clientTransportEnvKeys(options.appName).apiKeyKeys;
  const ownKeySet = new Set(ownKeys);
  const findings = [];
  const waivers = [];
  const invalidWaivers = [];
  const files = collectSourceFiles(repoRoot);
  const isOwnPackage = packageName(repoRoot) === "@hasna/contracts";
  for (const file of files) {
    let text;
    try {
      text = readFileSync3(file, "utf8");
    } catch {
      continue;
    }
    const path = relative2(repoRoot, file).replaceAll("\\", "/");
    if (!isOwnPackage) {
      for (const match of text.matchAll(SEAM_DEFINITION)) {
        findings.push({
          path,
          line: lineNumberAt(text, match.index ?? 0),
          variable: match[1],
          message: `${match[1]} is DEFINED here \u2014 this is a vendored copy of the @hasna/contracts client seam, ` + `not a use of it. A fork does not receive credential-resolution fixes, so it keeps resolving ` + `keys from the process environment however many times the shared package is corrected. ` + `Import it from @hasna/contracts/client instead.`
        });
      }
    }
    if (!text.includes("API_KEY"))
      continue;
    if (isInboundSurfacePath(path))
      continue;
    const rawLines = text.split(/\r?\n/);
    const maskedLines = maskComments2(text).split(/\r?\n/);
    const candidates = new Set(ownKeys);
    for (const match of text.matchAll(/\bHASNA_[A-Z0-9_]+_API_KEY\b/g)) {
      if (FOREIGN_CLIENT_KEY.test(match[0]))
        candidates.add(match[0]);
    }
    for (const [index, masked] of maskedLines.entries()) {
      if (!masked.includes("API_KEY"))
        continue;
      const lineNumber = index + 1;
      const waiverReason = waiverForLine(rawLines, index);
      const hit = firstReadOnLine(masked, candidates);
      if (!hit)
        continue;
      if (waiverReason !== null) {
        const waiver = { path, line: lineNumber, reason: waiverReason };
        const reason = waiverReason.trim();
        if (reason.length >= MIN_WAIVER_REASON_LENGTH && !EMPTY_REASONS.test(reason)) {
          waivers.push(waiver);
        } else {
          invalidWaivers.push(waiver);
        }
        continue;
      }
      findings.push({
        path,
        line: lineNumber,
        variable: hit,
        message: ownKeySet.has(hit) ? `${hit} is read straight from the process environment. Resolve it through @hasna/contracts/client instead ` + `(resolveClientTransport / createClientTransport / resolveCredential): an env read is a snapshot taken at ` + `process start, so it keeps serving a revoked key until the shell exits.` : `${hit} belongs to another service and is read straight from the process environment. Use that service's ` + `client through @hasna/contracts/client rather than resolving its credential by hand.`
      });
    }
  }
  return { findings, waivers, invalidWaivers, filesScanned: files.length };
}
function waiverForLine(rawLines, index) {
  for (const candidate of [rawLines[index], index > 0 ? rawLines[index - 1] : undefined]) {
    const match = candidate ? WAIVER_MARKER.exec(candidate) : null;
    if (match)
      return match[1].trim().replace(/\*\/\s*$/, "").trim();
  }
  return null;
}
function firstReadOnLine(masked, candidates) {
  for (const variable of candidates) {
    if (!masked.includes(variable))
      continue;
    for (const pattern of readPatterns(variable)) {
      pattern.lastIndex = 0;
      if (pattern.test(masked))
        return variable;
    }
  }
  COMPUTED_CLIENT_KEY_READ.lastIndex = 0;
  if (COMPUTED_CLIENT_KEY_READ.test(masked))
    return "HASNA_<APP>_API_KEY (computed)";
  return null;
}

// src/conformance.ts
function collectExportTargets(value) {
  if (typeof value === "string")
    return [value];
  if (Array.isArray(value))
    return value.flatMap(collectExportTargets);
  if (!value || typeof value !== "object")
    return [];
  return Object.values(value).flatMap(collectExportTargets);
}
function packageExportTargets(value) {
  if (typeof value === "string" || Array.isArray(value)) {
    return { ".": collectExportTargets(value) };
  }
  if (!value || typeof value !== "object")
    return {};
  const entries = Object.entries(value);
  if (entries.some(([key]) => key.startsWith("."))) {
    return Object.fromEntries(entries.filter(([key]) => key.startsWith(".")).map(([key, target]) => [key, collectExportTargets(target)]));
  }
  return { ".": collectExportTargets(value) };
}
function isFile(path) {
  try {
    return statSync3(path).isFile();
  } catch {
    return false;
  }
}
function sourceCandidatesForExportTarget(target) {
  if (!target.startsWith("./dist/"))
    return [];
  const relativeTarget = target.slice("./dist/".length);
  const sourceStem = relativeTarget.replace(/\.d\.(?:ts|mts|cts)$/i, "").replace(/\.(?:js|mjs|cjs|json)$/i, "");
  return [
    `./src/${sourceStem}.ts`,
    `./src/${sourceStem}.tsx`,
    `./src/${sourceStem}.mts`,
    `./src/${sourceStem}.cts`,
    `./src/${sourceStem}.json`
  ];
}
function exportTargetExists(repoRoot, target) {
  if (!target.startsWith("./"))
    return false;
  const resolved = join5(repoRoot, target);
  if (relative3(repoRoot, resolved).startsWith(".."))
    return false;
  if (isFile(resolved))
    return true;
  return sourceCandidatesForExportTarget(target).some((candidate) => isFile(join5(repoRoot, candidate)));
}
function packageJsonInfo(repoRoot) {
  const path = join5(repoRoot, "package.json");
  if (!existsSync2(path))
    return { present: false, bins: [], exportSubpaths: [], exportTargets: {} };
  try {
    const pkg = JSON.parse(readFileSync4(path, "utf8"));
    const defaultBinName = typeof pkg.name === "string" && pkg.name.length > 0 ? pkg.name.replace(/^@[^/]+\//, "") : "<default>";
    const bins = typeof pkg.bin === "string" ? [defaultBinName] : pkg.bin && typeof pkg.bin === "object" ? Object.keys(pkg.bin) : [];
    const exportTargets = packageExportTargets(pkg.exports);
    return { present: true, bins, exportSubpaths: Object.keys(exportTargets), exportTargets };
  } catch {
    return { present: true, bins: [], exportSubpaths: [], exportTargets: {} };
  }
}
function representedSurfaceKinds(manifest) {
  const kinds = new Set;
  for (const surface of manifest.serviceSurfaces) {
    if (surface.status !== "supported")
      continue;
    if (surface.kind) {
      kinds.add(surface.kind);
      continue;
    }
    if (surface.apiBasePath || surface.openApiPath || surface.health || surface.readiness || surface.version || surface.bin) {
      kinds.add("api");
    }
    if (surface.mcpBin)
      kinds.add("mcp");
  }
  return kinds;
}
var SELF_HOST_ARTIFACTS = [
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
  "Dockerfile"
];
function credentialKeyFinding(key) {
  const normalized = key.replace(/[^a-z0-9]/gi, "");
  if (/secretref$/i.test(normalized) || normalized === "databasedsnbindings") {
    return "secret-ref";
  }
  if (/(?:secret|secrets|credential|credentials|password|passphrase|privatekey|apikey|accesskey|token)(?:value|ref|reference|id|path|arn)?$/i.test(normalized) || /(?:databaseurl|dsn|connectionstring)$/i.test(normalized)) {
    return /(?:ref|reference|id|path|arn)$/i.test(normalized) ? "credential-ref" : "credential-value";
  }
  return null;
}
var HASNA_API_KEY_TOKEN_PATTERN = new RegExp(API_KEY_TOKEN_PATTERN.source.replace(/^\^/, "\\b").replace(/\$$/, "\\b"));
function credentialValueFinding(value) {
  const trimmed = value.trim();
  if (/^(?:vault|secret|credential|keychain|secretsmanager|aws-secretsmanager|ssm):(?:\/\/|[a-z0-9])/i.test(trimmed) || /(?:^|\/)(?:secrets?|credentials?)(?:\/|:)[a-z0-9._-]+/i.test(trimmed)) {
    return "credential-ref";
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(trimmed) || /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(trimmed) || /\bgh[pousr]_[A-Za-z0-9]{20,}\b/.test(trimmed) || /\bgithub_pat_[A-Za-z0-9_]{20,}\b/.test(trimmed) || /\bsk-[A-Za-z0-9_-]{16,}\b/.test(trimmed) || /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/.test(trimmed) || /\bBearer\s+[A-Za-z0-9._~+/-]{8,}\b/i.test(trimmed) || /^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s]+@/i.test(trimmed) || HASNA_API_KEY_TOKEN_PATTERN.test(trimmed) || /\b(?:password|passphrase|api[_-]?key|access[_-]?key|token|secret)\s*[:=]\s*\S{8,}/i.test(trimmed) || /(?:^|[^A-Za-z0-9_-])[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:$|[^A-Za-z0-9_-])/.test(trimmed)) {
    return "credential-value";
  }
  return null;
}
function isEnvVarName(value) {
  return typeof value === "string" && /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(value.trim());
}
function namesAnEnvironmentVariable(path, value) {
  if (!isEnvVarName(value))
    return false;
  const leaf = path.slice(path.lastIndexOf(".") + 1).replace(/\[\d+\]$/, "");
  const normalized = leaf.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return /^env(?:var|variable|name|key|prefix)?$/.test(normalized) || /(?:env|environment)(?:var|variable|name|key|prefix)$/.test(normalized) || /^(?:environmentvariable|envvarname|envvariable)$/.test(normalized);
}
function publicManifestFindings(value, path = "<root>") {
  const findings = [];
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      findings.push(...publicManifestFindings(item, `${path}[${index}]`));
    }
    return findings;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const childPath = path === "<root>" ? key : `${path}.${key}`;
      const keyFinding = namesAnEnvironmentVariable(childPath, child) ? null : credentialKeyFinding(childPath);
      if (keyFinding)
        findings.push({ path: childPath, category: keyFinding });
      findings.push(...publicManifestFindings(child, childPath));
    }
    return findings;
  }
  if (typeof value !== "string")
    return findings;
  if (/\bhasna\/oss\/[a-z0-9-]+(?:\/[a-z0-9._/-]+)?\b/i.test(value)) {
    findings.push({ path, category: "secret-ref" });
  }
  if (/\b(?:[a-z0-9-]+\.)*hasna\.xyz\b/i.test(value)) {
    findings.push({ path, category: "internal-host" });
  }
  if (/\barn:(?:aws|aws-us-gov|aws-cn):/i.test(value)) {
    findings.push({ path, category: "arn" });
  }
  if (/\b\d{12}\b/.test(value)) {
    findings.push({ path, category: "account-id" });
  }
  const credentialFinding = credentialValueFinding(value);
  if (credentialFinding) {
    findings.push({ path, category: credentialFinding });
  }
  return findings;
}
function unprintableWaiverFields(waiver) {
  const fields = [];
  if (publicManifestFindings(waiver.reason).length > 0)
    fields.push("reason");
  if (waiver.reviewedBy && publicManifestFindings(waiver.reviewedBy).length > 0)
    fields.push("reviewedBy");
  return fields;
}
function analyzeStorageWaivers(manifest, nowMs) {
  const declaredWaivers = manifest.metadata?.conformance?.waivedStorageEngines ?? [];
  const waivedEngines = new Set;
  const answeredEngines = new Set;
  const summaries = [];
  const failures = [];
  if (declaredWaivers.length === 0)
    return { waivedEngines, answeredEngines, summaries, failures };
  const ineligible = storageWaiverIneligibilityReason({
    class: manifest.class,
    name: manifest.name,
    bins: manifest.bins,
    hosting: manifest.hosting,
    storageBackend: manifest.storage?.backend,
    serviceSurfaces: manifest.serviceSurfaces
  });
  if (ineligible) {
    failures.push(`${ineligible}: ${declaredWaivers.map((waiver) => waiver.engine).join(", ")}`);
    return { waivedEngines, answeredEngines, summaries, failures };
  }
  const declaredEngines = new Set(manifest.storage?.engines ?? []);
  for (const waiver of declaredWaivers) {
    if (declaredEngines.has(waiver.engine))
      continue;
    const unprintable = unprintableWaiverFields(waiver);
    if (unprintable.length > 0) {
      answeredEngines.add(waiver.engine);
      failures.push(`storage waiver for ${waiver.engine} cannot be recorded: ${unprintable.join(", ")} carries a private infrastructure reference; rewrite the waiver without secret refs, internal hosts, ARNs, or account ids`);
      continue;
    }
    if (waiver.expiresAt && Date.parse(waiver.expiresAt) <= nowMs) {
      answeredEngines.add(waiver.engine);
      failures.push(`storage waiver for ${waiver.engine} expired at ${waiver.expiresAt}; declare the engine or renew the waiver`);
      continue;
    }
    waivedEngines.add(waiver.engine);
    answeredEngines.add(waiver.engine);
    const annotations = [];
    if (waiver.reviewedBy)
      annotations.push(`reviewed by ${waiver.reviewedBy}`);
    if (waiver.expiresAt)
      annotations.push(`expires ${waiver.expiresAt}`);
    const annotated = annotations.length > 0 ? ` (${annotations.join("; ")})` : "";
    summaries.push(`${waiver.engine} explicitly waived: ${waiver.reason}${annotated}`);
  }
  return { waivedEngines, answeredEngines, summaries, failures };
}
function resolveScriptGraph(scripts, entry) {
  const reached = new Set;
  const queue = [entry];
  const enqueue = (name) => {
    if (name in scripts)
      queue.push(name);
  };
  while (queue.length > 0) {
    const name = queue.shift();
    if (reached.has(name))
      continue;
    reached.add(name);
    enqueue(`pre${name}`);
    enqueue(`post${name}`);
    const body = scripts[name];
    if (!body)
      continue;
    for (const match of body.matchAll(/\b(?:bun|bunx|npm|pnpm|yarn)\s+(?:(?:--\S+|-\w)\s+)*(?:run\s+)?([a-zA-Z0-9_][\w:.-]*)/g)) {
      enqueue(match[1]);
    }
    for (const runner of body.matchAll(/\b(?:npm-run-all|run-s|run-p|concurrently)\b([^&|;]*)/g)) {
      for (const token of (runner[1] ?? "").split(/\s+/)) {
        const candidate = token.replace(/^["']|["']$/g, "");
        if (candidate && !candidate.startsWith("-"))
          enqueue(candidate);
      }
    }
  }
  return reached;
}
var NO_OP_COMMAND = /^(?:(?:\/usr)?\/bin\/)?(?::|true)$/;
function withoutComment(segment) {
  let inSingle = false;
  let inDouble = false;
  for (let index = 0;index < segment.length; index += 1) {
    const character = segment[index];
    if (character === "'" && !inDouble)
      inSingle = !inSingle;
    else if (character === '"' && !inSingle)
      inDouble = !inDouble;
    else if (character === "#" && !inSingle && !inDouble)
      return segment.slice(0, index);
  }
  return segment;
}
function segmentIsNoOp(segment) {
  const text = withoutComment(segment).trim();
  if (text === "")
    return true;
  const tokens = text.split(/\s+/).filter((token) => !/^(?:command|builtin|exec|nohup)$/.test(token));
  const [head, ...rest] = tokens;
  if (head === undefined)
    return true;
  if (NO_OP_COMMAND.test(head))
    return true;
  if (head === "exit" && (rest.length === 0 || rest[0] === "0"))
    return true;
  if (/^(?:(?:\/usr)?\/bin\/)?echo$/.test(head))
    return true;
  return false;
}
function scriptIsNoOp(body) {
  return body.split(/&&|\|\||;|\n/).every(segmentIsNoOp);
}
function unpinnedPackageRunnerInvocations(body) {
  const unpinned = [];
  for (const segment of body.split(/&&|\|\||;/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    for (const [index, token] of tokens.entries()) {
      if (token !== "bunx" && token !== "npx")
        continue;
      const spec = tokens.slice(index + 1).find((candidate) => !candidate.startsWith("-"));
      if (spec === undefined)
        continue;
      const versionAt = spec.indexOf("@", spec.startsWith("@") ? 1 : 0);
      if (versionAt === -1)
        unpinned.push(`${token} ${spec}`);
      break;
    }
  }
  return unpinned;
}
function publishedArtifactGateCheck(repoRoot, manifest) {
  const packagePath = join5(repoRoot, "package.json");
  if (!existsSync2(packagePath)) {
    return { id: "published_artifact_gate", status: "skip", detail: "no package.json found" };
  }
  let pkg;
  try {
    pkg = JSON.parse(readFileSync4(packagePath, "utf8"));
  } catch {
    return { id: "published_artifact_gate", status: "fail", detail: "package.json is not valid JSON" };
  }
  if (pkg.private === true) {
    return { id: "published_artifact_gate", status: "skip", detail: "package is private; it publishes no artifact" };
  }
  const scripts = {};
  if (pkg.scripts && typeof pkg.scripts === "object") {
    for (const [name, body] of Object.entries(pkg.scripts)) {
      if (typeof body === "string")
        scripts[name] = body;
    }
  }
  const declared = manifest.metadata?.release?.artifactScan?.script;
  if (!declared) {
    return {
      id: "published_artifact_gate",
      status: "fail",
      detail: "metadata.release.artifactScan.script is required for a published package: name the script that scans the PACKED artifact, then wire it into prepack"
    };
  }
  const failures = [];
  if (!(declared in scripts)) {
    failures.push(`metadata.release.artifactScan.script names '${declared}', which is not a package script`);
  } else if (scriptIsNoOp(scripts[declared])) {
    failures.push(`'${declared}' is a no-op ('${scripts[declared]}'); a gate that runs nothing is the bypass this clause exists to close`);
  }
  if (!("prepack" in scripts)) {
    failures.push("no prepack script: a release gate bound only to a custom script can be bypassed by publishing directly");
  } else if (declared in scripts && !resolveScriptGraph(scripts, "prepack").has(declared)) {
    failures.push(`prepack does not reach '${declared}'; the scan runs only when someone remembers to call it`);
  }
  for (const invocation of unpinnedPackageRunnerInvocations(scripts[declared] ?? "")) {
    failures.push(`'${declared}' invokes ${invocation} without a version pin; pin the kit version so the gate is reproducible`);
  }
  return failures.length === 0 ? {
    id: "published_artifact_gate",
    status: "pass",
    detail: `prepack reaches the declared packed-artifact scan '${declared}'`
  } : { id: "published_artifact_gate", status: "fail", detail: failures.join("; ") };
}
function credentialSeamCheck(repoRoot, appName, skip) {
  if (skip) {
    return { id: "credential_seam_compliance", status: "skip", detail: "skipped by caller" };
  }
  let scan;
  try {
    scan = scanCredentialSeam(repoRoot, { appName });
  } catch (error2) {
    const message = error2 instanceof Error ? error2.message : String(error2);
    return { id: "credential_seam_compliance", status: "fail", detail: `credential-seam scan error: ${message}` };
  }
  const failures = [];
  for (const finding of scan.findings) {
    failures.push(`${finding.path}:${finding.line} ${finding.message}`);
  }
  for (const waiver of scan.invalidWaivers) {
    failures.push(`${waiver.path}:${waiver.line} carries a credential-seam waiver with no usable justification ` + `('${waiver.reason}'); state why this read cannot go through the seam.`);
  }
  if (failures.length > 0) {
    return { id: "credential_seam_compliance", status: "fail", detail: failures.join("; ") };
  }
  const waived = scan.waivers.length > 0 ? `; explicitly waived: ${scan.waivers.map((waiver) => `${waiver.path}:${waiver.line} (${waiver.reason})`).join("; ")}` : "";
  return {
    id: "credential_seam_compliance",
    status: "pass",
    detail: `no hand-rolled client credential reads across ${scan.filesScanned} source files${waived}`
  };
}
function runRepoConformance(repoRoot, options = {}) {
  const checks3 = [];
  const loaded = loadServiceContractManifest(repoRoot);
  if (!loaded.ok) {
    const issueDetail = loaded.issues ? `: ${loaded.issues.map((issue2) => `${issue2.path.join(".") || "<root>"} ${issue2.message}`).join("; ")}` : "";
    checks3.push({ id: "manifest_valid", status: "fail", detail: `${loaded.error}${issueDetail}` });
    return { ok: false, repoRoot, name: null, class: null, checks: checks3 };
  }
  const manifest = loaded.manifest;
  checks3.push({ id: "manifest_valid", status: "pass", detail: `hasna.contract.json valid for ${manifest.name} (${manifest.class})` });
  const allowed = new Set(allowedBinsForName(manifest.name));
  const outOfAllowlist = manifest.bins.filter((bin) => !allowed.has(bin));
  if (outOfAllowlist.length > 0) {
    checks3.push({ id: "bins_allowlisted", status: "fail", detail: `bins outside allowlist: ${outOfAllowlist.join(", ")}` });
  } else {
    checks3.push({ id: "bins_allowlisted", status: "pass", detail: `bins allowlisted: ${manifest.bins.join(", ") || "(none)"}` });
  }
  const pkg = packageJsonInfo(repoRoot);
  if (!pkg.present) {
    checks3.push({ id: "bins_match_package", status: "skip", detail: "no package.json found" });
  } else {
    const declared = new Set(manifest.bins);
    const missing = manifest.bins.filter((bin) => !pkg.bins.includes(bin));
    const undeclared = pkg.bins.filter((bin) => !declared.has(bin));
    if (missing.length > 0 || undeclared.length > 0) {
      const parts = [];
      if (missing.length > 0)
        parts.push(`declared but missing from package.json: ${missing.join(", ")}`);
      if (undeclared.length > 0)
        parts.push(`in package.json but undeclared: ${undeclared.join(", ")}`);
      checks3.push({ id: "bins_match_package", status: "fail", detail: parts.join("; ") });
    } else {
      checks3.push({ id: "bins_match_package", status: "pass", detail: "declared bins match package.json bin" });
    }
  }
  const hasServeBin = manifest.bins.includes(`${manifest.name}-serve`) || manifest.class === "service" || manifest.class === "saas";
  const requiresGeneratedServiceSdk = manifest.class === "service" || manifest.class === "saas" || manifest.class === "cli-with-store" && manifest.bins.includes(`${manifest.name}-serve`);
  const representedKinds = representedSurfaceKinds(manifest);
  const waivers = manifest.metadata?.conformance?.waivedSurfaces ?? [];
  const waiverProfile = manifest.metadata?.conformance?.waiverProfile;
  const eligibleWaiverKinds = waiverProfile === "non-node-monorepo" ? new Set(SERVICE_SURFACE_KINDS) : manifest.class === "library" ? new Set(["api", "mcp"]) : new Set;
  const ineligibleWaivers = waivers.filter((waiver) => !eligibleWaiverKinds.has(waiver.kind));
  const waivedKinds = new Set(waivers.filter((waiver) => eligibleWaiverKinds.has(waiver.kind)).map((waiver) => waiver.kind));
  const requiredSurfaceKinds = manifest.class === "cli-with-store" && !hasServeBin ? ["cli"] : SERVICE_SURFACE_KINDS;
  const missingKinds = requiredSurfaceKinds.filter((kind) => !representedKinds.has(kind) && !waivedKinds.has(kind));
  if (missingKinds.length > 0 || ineligibleWaivers.length > 0) {
    const failures = [];
    if (missingKinds.length > 0) {
      failures.push(`missing supported surface declarations or eligible waivers: ${missingKinds.join(", ")}`);
    }
    if (ineligibleWaivers.length > 0) {
      failures.push(`waivers not permitted for class ${manifest.class}${waiverProfile ? ` with profile ${waiverProfile}` : ""}: ${ineligibleWaivers.map((waiver) => waiver.kind).join(", ")}`);
    }
    checks3.push({
      id: "surface_matrix",
      status: "fail",
      detail: failures.join("; ")
    });
  } else {
    checks3.push({
      id: "surface_matrix",
      status: "pass",
      detail: `API, SDK, MCP, and CLI are declared or explicitly waived`
    });
  }
  const surfaceBindingFailures = [];
  const apiOpenApiPaths = new Set(manifest.serviceSurfaces.filter((surface) => surface.kind === "api" || !surface.kind && Boolean(surface.openApiPath)).map((surface) => surface.openApiPath).filter((value) => Boolean(value)));
  for (const [index, surface] of manifest.serviceSurfaces.entries()) {
    if (surface.bin && !pkg.bins.includes(surface.bin)) {
      surfaceBindingFailures.push(`serviceSurfaces[${index}].bin is not in package.json bin`);
    }
    if (surface.mcpBin && !pkg.bins.includes(surface.mcpBin)) {
      surfaceBindingFailures.push(`serviceSurfaces[${index}].mcpBin is not in package.json bin`);
    }
    if (surface.kind === "sdk" && surface.status === "supported") {
      if (!surface.exportSubpath || !pkg.exportSubpaths.includes(surface.exportSubpath)) {
        surfaceBindingFailures.push(`serviceSurfaces[${index}].exportSubpath is not in package.json exports`);
      } else {
        const targets = pkg.exportTargets[surface.exportSubpath] ?? [];
        const missingTargets = targets.filter((target) => !exportTargetExists(repoRoot, target));
        if (targets.length === 0) {
          surfaceBindingFailures.push(`serviceSurfaces[${index}].exportSubpath has no package export file target`);
        } else if (missingTargets.length > 0) {
          surfaceBindingFailures.push(`serviceSurfaces[${index}].exportSubpath targets missing files: ${missingTargets.join(", ")}`);
        }
      }
      if (requiresGeneratedServiceSdk && !surface.generatedFrom) {
        surfaceBindingFailures.push(`serviceSurfaces[${index}].generatedFrom is required for a supported service SDK`);
      } else if (surface.generatedFrom && !apiOpenApiPaths.has(surface.generatedFrom)) {
        surfaceBindingFailures.push(`serviceSurfaces[${index}].generatedFrom does not match a declared API openApiPath`);
      }
    }
  }
  checks3.push({
    id: "surface_bindings",
    status: surfaceBindingFailures.length === 0 ? "pass" : "fail",
    detail: surfaceBindingFailures.length === 0 ? "declared surface bins and SDK exports match package.json" : surfaceBindingFailures.join("; ")
  });
  const apiTopologyFailures = [];
  if (requiresGeneratedServiceSdk) {
    const apiSurfaces = manifest.serviceSurfaces.filter((surface) => surface.status === "supported" && (surface.kind === "api" || !surface.kind && Boolean(surface.apiBasePath || surface.openApiPath || surface.health || surface.readiness || surface.version)));
    if (apiSurfaces.length === 0) {
      apiTopologyFailures.push("a supported API surface is required");
    }
    for (const [index, surface] of apiSurfaces.entries()) {
      for (const [label, endpoint, path] of [
        ["health", surface.health, "/health"],
        ["readiness", surface.readiness, "/ready"],
        ["version", surface.version, "/version"]
      ]) {
        if (!endpoint || endpoint.method !== "GET" || endpoint.path !== path) {
          apiTopologyFailures.push(`supported API surface ${index} must declare GET ${path} (${label})`);
        }
      }
    }
  }
  checks3.push({
    id: "service_api_topology",
    status: requiresGeneratedServiceSdk ? apiTopologyFailures.length === 0 ? "pass" : "fail" : "skip",
    detail: requiresGeneratedServiceSdk ? apiTopologyFailures.length === 0 ? "supported API declares GET /health, GET /ready, and GET /version" : apiTopologyFailures.join("; ") : `${manifest.class} repo has no required service API topology`
  });
  if (requiresGeneratedServiceSdk) {
    const presentArtifacts = SELF_HOST_ARTIFACTS.filter((artifact) => isFile(join5(repoRoot, artifact)));
    checks3.push({
      id: "self_host_artifact",
      status: presentArtifacts.length > 0 ? "pass" : "fail",
      detail: presentArtifacts.length > 0 ? `self-host deployment artifact present: ${presentArtifacts.join(", ")}` : `service-class repos require one self-host deployment artifact: ${SELF_HOST_ARTIFACTS.join(", ")}`
    });
  } else {
    checks3.push({
      id: "self_host_artifact",
      status: "skip",
      detail: `${manifest.class} repo has no required self-host service artifact`
    });
  }
  const storageWaivers = analyzeStorageWaivers(manifest, (options.now ?? new Date).getTime());
  if (manifest.class === "saas") {
    const failures = [...storageWaivers.failures];
    if (!manifest.storage?.envPrefix)
      failures.push("storage.envPrefix is required for the public SaaS DATABASE_URL contract");
    checks3.push({
      id: "storage_capabilities",
      status: failures.length === 0 ? "pass" : "fail",
      detail: failures.length === 0 ? "SaaS PostgreSQL env contract declared" : failures.join("; ")
    });
  } else if (manifest.class !== "service" && manifest.class !== "cli-with-store") {
    checks3.push({
      id: "storage_capabilities",
      status: storageWaivers.failures.length === 0 ? "skip" : "fail",
      detail: storageWaivers.failures.length === 0 ? `${manifest.class} repo is outside the dual-storage core gate` : storageWaivers.failures.join("; ")
    });
  } else {
    const engines = manifest.storage?.engines ?? [];
    const declaredEngines = new Set(engines);
    const failures = [...storageWaivers.failures];
    if (manifest.class === "cli-with-store") {
      const missingEngines = STORAGE_ENGINES.filter((engine) => !declaredEngines.has(engine) && !storageWaivers.answeredEngines.has(engine));
      if (missingEngines.length > 0)
        failures.push(`missing storage engines: ${missingEngines.join(", ")}`);
    } else {
      if (!declaredEngines.has("postgresql"))
        failures.push("missing storage engine: postgresql");
    }
    if (!storageWaivers.answeredEngines.has("postgresql")) {
      if (!manifest.storage?.envPrefix)
        failures.push("storage.envPrefix is required for the PostgreSQL DATABASE_URL contract");
      if (!manifest.storage?.pgTestGate)
        failures.push("storage.pgTestGate is required to prove live PostgreSQL support");
    }
    const declaredDetail = engines.length > 0 ? `${engines.join(", ")} declared` : "no storage engines declared";
    checks3.push({
      id: "storage_capabilities",
      status: failures.length === 0 ? "pass" : "fail",
      detail: failures.length > 0 ? failures.join("; ") : storageWaivers.summaries.length > 0 ? `${declaredDetail}; ${storageWaivers.summaries.join("; ")}` : LOCAL_STORAGE_ENGINES.some((engine) => declaredEngines.has(engine)) ? `${engines.join(" and ")} capabilities plus live-PG gate declared` : "postgresql capability plus live-PG gate declared"
    });
  }
  if ((options.manifestTier ?? "public") === "private") {
    checks3.push({ id: "public_manifest_safety", status: "skip", detail: "private-tier manifest selected by caller" });
  } else {
    const findings = publicManifestFindings(manifest);
    const unique = [...new Map(findings.map((finding) => [`${finding.path}:${finding.category}`, finding])).values()];
    checks3.push({
      id: "public_manifest_safety",
      status: unique.length === 0 ? "pass" : "fail",
      detail: unique.length === 0 ? "no private secret or credential references, credential values, internal hosts, ARNs, or account IDs" : `private infrastructure references at ${unique.map((finding) => `${finding.path} (${finding.category})`).join(", ")}`
    });
  }
  const requiredHosting = manifest.class === "saas" ? "hasna-saas" : "user-hosted";
  checks3.push({
    id: "hosting_story",
    status: manifest.hosting.includes(requiredHosting) ? "pass" : "fail",
    detail: manifest.hosting.includes(requiredHosting) ? manifest.class === "saas" ? `Hasna SaaS control-plane story declared${manifest.hosting.includes("user-hosted") ? " with user-hosted parity" : ""}` : `user-hosted product story declared${manifest.hosting.includes("hasna-saas") ? " with optional Hasna SaaS" : ""}` : manifest.class === "saas" ? "saas repos must declare the hasna-saas product story" : "public OSS cores must declare the user-hosted product story"
  });
  const env = options.env ?? process.env;
  const keys = serverDataBackendEnvKeys(manifest.name).databaseUrlKeys;
  if (!hasServeBin && manifest.class !== "service" && manifest.class !== "saas") {
    checks3.push({
      id: "server_backend_configuration",
      status: "skip",
      detail: "no server runtime declared; PostgreSQL backend configuration is not applicable"
    });
  } else {
    const hasDatabaseUrlDeclaration = keys.some((key) => Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined);
    if (!hasDatabaseUrlDeclaration) {
      try {
        resolveServerDataBackend(manifest.name, env);
        checks3.push({
          id: "server_backend_configuration",
          status: "fail",
          detail: "server backend resolver did not fail closed when DATABASE_URL was absent"
        });
      } catch {
        checks3.push({
          id: "server_backend_configuration",
          status: "pass",
          detail: `${keys[0]} is not declared; the server resolver fails closed instead of selecting SQLite`
        });
      }
    } else {
      try {
        const resolution = resolveServerDataBackend(manifest.name, env);
        checks3.push({
          id: "server_backend_configuration",
          status: "pass",
          detail: `${resolution.databaseUrlSource} configures authoritative postgresql`
        });
      } catch (error2) {
        checks3.push({
          id: "server_backend_configuration",
          status: "fail",
          detail: error2 instanceof Error ? error2.message : `invalid PostgreSQL configuration (keys: ${keys.join(", ")})`
        });
      }
    }
  }
  if (!hasServeBin) {
    checks3.push({ id: "health_shape", status: "skip", detail: "no serve bin declared" });
  } else if (options.healthSample === undefined) {
    checks3.push({ id: "health_shape", status: "skip", detail: "serve bin present; no health sample provided to shape-check" });
  } else {
    const result = HealthResponseSchema.safeParse(options.healthSample);
    if (result.success) {
      checks3.push({ id: "health_shape", status: "pass", detail: "GET /health payload matches { status, version, backend }" });
    } else {
      checks3.push({
        id: "health_shape",
        status: "fail",
        detail: `health payload invalid: ${result.error.issues.map((i) => `${i.path.join(".") || "<root>"} ${i.message}`).join("; ")}`
      });
    }
  }
  checks3.push(publishedArtifactGateCheck(repoRoot, manifest));
  checks3.push(credentialSeamCheck(repoRoot, manifest.name, options.skipCredentialSeamScan));
  if (options.skipNoCloudScan) {
    checks3.push({ id: "no_cloud_guard", status: "skip", detail: "skipped by caller" });
  } else {
    try {
      const pack = scanNoCloudTarget(repoRoot);
      if (pack.verdict === "passed") {
        checks3.push({ id: "no_cloud_guard", status: "pass", detail: "no forbidden shared cloud runtime edges" });
      } else {
        const top = pack.findings.filter((f) => f.severity === "high" || f.severity === "critical").slice(0, 5).map((f) => `${f.severity} ${f.path ?? "<manifest>"}: ${f.message}`).join("; ");
        checks3.push({ id: "no_cloud_guard", status: "fail", detail: top || "no-cloud scan failed" });
      }
    } catch (error2) {
      const message = error2 instanceof Error ? error2.message : String(error2);
      checks3.push({ id: "no_cloud_guard", status: "fail", detail: `no-cloud scan error: ${message}` });
    }
  }
  const ok = checks3.every((check2) => check2.status !== "fail");
  return { ok, repoRoot, name: manifest.name, class: manifest.class, checks: checks3 };
}

// src/validators.ts
function getEmbeddedSchemaId(value) {
  if (!value || typeof value !== "object" || !("schema" in value)) {
    return null;
  }
  const schemaId = value.schema;
  return typeof schemaId === "string" && schemaId in ContractSchemaRegistry ? schemaId : null;
}
function validateContract(schemaId, value) {
  const schema = ContractSchemaRegistry[schemaId];
  return schema.safeParse(value);
}

// src/secure-local-store.ts
var SECURE_LOCAL_STORE_POLICY_VERSION = "2026-07-06";
function retentionAdapter(id, description, ttlDays, artifactClasses, allowlistGlobs, activeRecordExclusions = [], sqliteMaintenance) {
  return {
    id,
    description,
    ttlDays,
    artifactClasses,
    allowlistGlobs,
    activeRecordExclusions: activeRecordExclusions.map((exclusion) => ({ ...exclusion, required: exclusion.required ?? true })),
    sqliteMaintenance
  };
}
var DEFAULT_SECURE_LOCAL_STORE_POLICY = SecureLocalStorePolicySchema.parse({
  schema: SCHEMA_IDS.secureLocalStorePolicy,
  id: "hasna-secure-local-store-defaults",
  createdAt: "2026-07-06T00:00:00.000Z",
  version: SECURE_LOCAL_STORE_POLICY_VERSION,
  scope: [".hasna", ".codewith"],
  defaults: {
    directoryMode: "0700",
    fileMode: "0600",
    dryRunDefault: true,
    requireExplicitApply: true,
    includeSqliteSidecars: true,
    redactedEvidenceOnly: true
  },
  lifecycle: {
    retentionDryRunDefault: true,
    requireActiveRecordExclusionProof: true,
    requireArtifactAllowlist: true,
    sqliteMaintenanceRequiresExclusiveAccess: true
  },
  stores: [
    {
      storeId: "codewith",
      packageName: "codewith",
      displayName: "Codewith native state",
      root: ".codewith",
      relativePath: ".",
      sqliteDatabaseGlobs: ["logs_*.sqlite", "state_*.sqlite", "goals_*.sqlite"],
      sensitiveFileGlobs: ["sessions/**/*.jsonl", "shell_snapshots/**/*", "logs*.sqlite", "state*.sqlite", "goals*.sqlite"],
      backupGlobs: ["backups/**/*"],
      exportGlobs: ["exports/**/*"],
      retentionAdapters: [
        retentionAdapter("codewith-session-snapshots", "Codewith sessions, shell snapshots, logs, monitor output, mailbox payloads, and scheduler state need package-owned redaction before retention applies.", 30, ["session", "snapshot", "log"], ["sessions/**/*.jsonl", "shell_snapshots/**/*", "logs/**/*"], [
          {
            id: "codewith-active-session",
            source: "package_adapter",
            description: "Exclude currently active sessions, leased schedules, monitors, pending interactions, and active goal rows."
          }
        ], { safeWhen: "exclusive_access", operations: ["wal_checkpoint_truncate", "optimize"] })
      ],
      notes: ["Includes native .codewith DBs and transcript-like artifacts; redaction-before-persistence remains package-owned."]
    },
    {
      storeId: "todos",
      packageName: "@hasna/todos",
      displayName: "Todos",
      root: ".hasna",
      relativePath: "todos",
      sqliteDatabaseGlobs: ["todos.db"],
      sensitiveFileGlobs: ["todos.db", "todos.db-wal", "todos.db-shm", "exports/**/*", "backups/**/*"],
      backupGlobs: ["backups/**/*", "*.bak", "*.backup"],
      exportGlobs: ["exports/**/*", "*.jsonl", "*.csv"],
      retentionAdapters: [
        retentionAdapter("todos-exports-backups", "Todos backups and exports are deleted only after package redaction and active task/evidence references are excluded.", 14, ["backup", "export"], ["backups/**/*", "exports/**/*"], [
          {
            id: "todos-active-evidence",
            source: "sqlite",
            table: "task_files",
            column: "path",
            description: "Exclude files still referenced by active tasks, verification evidence, task comments, or handoff records."
          }
        ], { safeWhen: "exclusive_access", operations: ["wal_checkpoint_truncate", "optimize"] })
      ]
    },
    {
      storeId: "conversations",
      packageName: "@hasna/conversations",
      displayName: "Conversations",
      root: ".hasna",
      relativePath: "conversations",
      sqliteDatabaseGlobs: ["messages.db"],
      sensitiveFileGlobs: ["messages.db", "messages.db-wal", "messages.db-shm", "exports/**/*", "attachments/**/*"],
      backupGlobs: ["backups/**/*", "*.bak"],
      exportGlobs: ["exports/**/*", "*.json", "*.csv"],
      retentionAdapters: [
        retentionAdapter("conversations-exports-attachments", "Conversation exports and attachments require message-id redaction and active attachment reference checks before deletion.", 14, ["export", "backup"], ["exports/**/*", "backups/**/*", "attachments/**/*"], [
          {
            id: "conversations-active-attachments",
            source: "sqlite",
            table: "messages",
            column: "attachments",
            description: "Exclude attachments still referenced by retained messages or audited redaction records."
          }
        ], { safeWhen: "exclusive_access", operations: ["wal_checkpoint_truncate", "optimize"] })
      ]
    },
    {
      storeId: "mementos",
      packageName: "@hasna/mementos",
      displayName: "Mementos",
      root: ".hasna",
      relativePath: "mementos",
      sqliteDatabaseGlobs: ["mementos.db"],
      sensitiveFileGlobs: ["mementos.db", "mementos.db-wal", "mementos.db-shm", "exports/**/*", "backups/**/*"],
      backupGlobs: ["backups/**/*", "*.bak"],
      exportGlobs: ["exports/**/*"],
      retentionAdapters: [
        retentionAdapter("mementos-audit-search-history", "Mementos retention must preserve active memory versions while compacting audit/search surfaces through package-owned adapters.", 30, ["backup", "export", "log"], ["backups/**/*", "exports/**/*", "audit/**/*"], [
          {
            id: "mementos-active-memory-versions",
            source: "sqlite",
            table: "memory_versions",
            column: "memory_id",
            description: "Exclude current memory versions and audit entries required for provenance."
          }
        ], { safeWhen: "exclusive_access", operations: ["wal_checkpoint_truncate", "optimize"] })
      ]
    },
    {
      storeId: "knowledge",
      packageName: "@hasna/knowledge",
      displayName: "Knowledge",
      root: ".hasna",
      relativePath: "knowledge",
      sqliteDatabaseGlobs: ["knowledge.db"],
      sensitiveFileGlobs: ["knowledge.db", "knowledge.db-wal", "knowledge.db-shm", "db.json", "migration-exports/**/*", "*.bak"],
      backupGlobs: ["*.bak", "backups/**/*", "*.pre-cloud-*"],
      exportGlobs: ["migration-exports/**/*", "exports/**/*", "*.jsonl"],
      retentionAdapters: [
        retentionAdapter("knowledge-migrations-exports", "Knowledge migration exports and pre-cloud backups require replacement, encryption, or redaction before retention deletion.", 14, ["backup", "export"], ["migration-exports/**/*", "exports/**/*", "*.bak", "*.pre-cloud-*"], [
          {
            id: "knowledge-current-catalog",
            source: "manifest",
            description: "Exclude files referenced by the active catalog or migration ledger."
          }
        ], { safeWhen: "exclusive_access", operations: ["wal_checkpoint_truncate", "optimize"] })
      ]
    },
    {
      storeId: "projects",
      packageName: "@hasna/projects",
      displayName: "Projects",
      root: ".hasna",
      relativePath: "projects",
      sqliteDatabaseGlobs: ["projects.db", "data/*/project.db"],
      sensitiveFileGlobs: ["projects.db", "projects.db-wal", "projects.db-shm", "data/*/project.db", "data/*/project.db-wal", "data/*/project.db-shm", "reports/**/*"],
      backupGlobs: ["backups/**/*", "data/*/backups/**/*"],
      exportGlobs: ["reports/**/*", "exports/**/*"],
      retentionAdapters: [
        retentionAdapter("projects-reports-workspaces", "Project reports, dashboards, workspaces, and per-project DBs need active workspace/location references before cleanup.", 30, ["backup", "export", "report", "tmp"], ["backups/**/*", "reports/**/*", "workspaces/**/*", "data/*/backups/**/*"], [
          {
            id: "projects-active-workspaces",
            source: "sqlite",
            table: "workspaces",
            column: "primary_path",
            description: "Exclude active workspace paths, locations, linked reports, and project store artifacts."
          }
        ], { safeWhen: "exclusive_access", operations: ["wal_checkpoint_truncate", "optimize"] })
      ]
    },
    {
      storeId: "browser",
      packageName: "@hasna/browser",
      displayName: "Browser",
      root: ".hasna",
      relativePath: "browser",
      sqliteDatabaseGlobs: ["browser.db"],
      sensitiveFileGlobs: ["browser.db", "browser.db-wal", "browser.db-shm", "profiles/**/cookies.json", "states/**/*.json", "auth/**/*"],
      backupGlobs: ["backups/**/*"],
      exportGlobs: ["exports/**/*", "traces/**/*", "har/**/*"],
      retentionAdapters: [
        retentionAdapter("browser-auth-traces", "Browser state, trace, HAR, and auth artifacts require session invalidation or redaction before deletion.", 7, ["backup", "export", "session", "snapshot"], ["profiles/**/*", "states/**/*", "traces/**/*", "har/**/*", "exports/**/*"], [
          {
            id: "browser-active-profiles",
            source: "sqlite",
            table: "sessions",
            column: "profile_path",
            description: "Exclude profiles, cookies, and storage state used by active browser sessions."
          }
        ], { safeWhen: "exclusive_access", operations: ["wal_checkpoint_truncate", "optimize"] })
      ]
    },
    {
      storeId: "logs",
      packageName: "@hasna/logs",
      displayName: "Logs",
      root: ".hasna",
      relativePath: "logs",
      sqliteDatabaseGlobs: ["logs.db"],
      sensitiveFileGlobs: ["logs.db", "logs.db-wal", "logs.db-shm", "exports/**/*"],
      backupGlobs: ["backups/**/*"],
      exportGlobs: ["exports/**/*"],
      retentionAdapters: [
        retentionAdapter("logs-retention", "Logs require redaction before compaction and must preserve active incident/evidence references.", 14, ["backup", "export", "log"], ["backups/**/*", "exports/**/*", "*.log", "logs/**/*"], [
          {
            id: "logs-active-evidence",
            source: "sqlite",
            table: "logs",
            column: "id",
            description: "Exclude log rows or files linked to active incidents, tasks, or proof bundles."
          }
        ], { safeWhen: "exclusive_access", operations: ["wal_checkpoint_truncate", "optimize"] })
      ]
    },
    {
      storeId: "loops",
      packageName: "@hasna/loops",
      displayName: "OpenLoops",
      root: ".hasna",
      relativePath: "loops",
      sqliteDatabaseGlobs: ["loops.db", "state.db", "*.sqlite"],
      sensitiveFileGlobs: ["*.db", "*.sqlite", "*.db-wal", "*.db-shm", "reports/**/*", "tmp/**/*", "runs/**/*"],
      backupGlobs: ["backups/**/*", "tmp/**/*"],
      exportGlobs: ["reports/**/*", "runs/**/*", "exports/**/*"],
      retentionAdapters: [
        retentionAdapter("loops-reports-tmp", "Loop reports, tmp files, workflow artifacts, and command output need run-state checks and redaction before retention deletion.", 14, ["backup", "export", "report", "tmp", "log"], ["reports/**/*", "tmp/**/*", "runs/**/*", "exports/**/*"], [
          {
            id: "loops-active-runs",
            source: "sqlite",
            table: "loop_runs",
            column: "id",
            description: "Exclude active, leased, recently failed, or evidence-linked loop and workflow run artifacts."
          }
        ], { safeWhen: "exclusive_access", operations: ["wal_checkpoint_truncate", "optimize"] })
      ]
    }
  ],
  warnings: [
    "This package publishes declarations only; each owning package implements and verifies its own local-store lifecycle.",
    "Retention and redaction evidence remain package-owned and must preserve active-record exclusions.",
    "SQLite maintenance is descriptive policy metadata only and is never executed by @hasna/contracts."
  ]
});
function secureLocalStorePolicy(stores) {
  if (!stores || stores.length === 0) {
    return DEFAULT_SECURE_LOCAL_STORE_POLICY;
  }
  const selected = new Set(stores);
  const known = new Set(DEFAULT_SECURE_LOCAL_STORE_POLICY.stores.map((store) => store.storeId));
  const unknown2 = stores.filter((store) => !known.has(store));
  if (unknown2.length > 0) {
    throw new Error(`Unknown secure local store id: ${unknown2.join(", ")}`);
  }
  return SecureLocalStorePolicySchema.parse({
    ...DEFAULT_SECURE_LOCAL_STORE_POLICY,
    stores: DEFAULT_SECURE_LOCAL_STORE_POLICY.stores.filter((store) => selected.has(store.storeId))
  });
}

// src/kit/generate.ts
import { createHash as createHash4 } from "crypto";
import { existsSync as existsSync3, mkdirSync, readdirSync as readdirSync3, readFileSync as readFileSync5, unlinkSync, writeFileSync } from "fs";
import { dirname, join as join6, resolve as resolve3 } from "path";
import { fileURLToPath } from "url";
var KIT_TEMPLATE_FILES = [
  "own.ts",
  "backend.ts",
  "tls.ts",
  "query.ts",
  "pool.ts",
  "migrations.ts",
  "health.ts",
  "index.ts",
  "README.md"
];
var RETIRED_KIT_FILES = ["mode.ts"];
var KIT_DEPENDENCY_NAME = "@hasna/contracts";
var KIT_TARGET_SUBDIR = "src/generated/storage-kit";
var KIT_MANIFEST_FILE = ".storage-kit-manifest.json";
var KIT_VERSION_PLACEHOLDER = "__KIT_VERSION__";
function baseMajorMinor(spec) {
  const m = spec.trim().match(/^[\^~><=*\s]*(\d+)\.(\d+)/);
  if (!m)
    return null;
  return { major: Number(m[1]), minor: Number(m[2]) };
}
function kitMatchesDeclaredDependency(kitVersion, declared) {
  if (declared.trim() === "*" || declared.includes("workspace:") || declared.includes(" || "))
    return null;
  const opMatch = declared.trim().match(/^([\^~><=]*)\s*(\d+\.\d+)/);
  if (!opMatch)
    return null;
  const op = opMatch[1];
  const dep = baseMajorMinor(declared);
  const kit = baseMajorMinor(kitVersion);
  if (!dep || !kit)
    return null;
  if (kit.major !== dep.major)
    return op === ">=" || op === ">";
  if (op === ">=" || op === ">")
    return kit.minor >= dep.minor;
  return kit.minor === dep.minor;
}
function readDeclaredKitDependency(targetRepo) {
  const pkgPath = join6(resolve3(targetRepo), "package.json");
  if (!existsSync3(pkgPath))
    return null;
  try {
    const pkg = JSON.parse(readFileSync5(pkgPath, "utf8"));
    for (const section of ["dependencies", "devDependencies", "peerDependencies"]) {
      const declared = pkg[section]?.[KIT_DEPENDENCY_NAME];
      if (typeof declared === "string" && declared.length > 0)
        return declared;
    }
  } catch {}
  return null;
}
function moduleDir() {
  return dirname(fileURLToPath(import.meta.url));
}
function findPackageRoot(start = moduleDir()) {
  let dir = start;
  for (let i = 0;i < 8; i++) {
    const pkgPath = join6(dir, "package.json");
    if (existsSync3(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync5(pkgPath, "utf8"));
        if (pkg.name === "@hasna/contracts")
          return dir;
      } catch {}
    }
    const parent = dirname(dir);
    if (parent === dir)
      break;
    dir = parent;
  }
  throw new Error("Could not locate the @hasna/contracts package root.");
}
function resolveTemplatesDir() {
  const candidates = [
    join6(moduleDir(), "templates"),
    join6(findPackageRoot(), "src", "kit", "templates")
  ];
  for (const candidate of candidates) {
    if (existsSync3(join6(candidate, "index.ts")))
      return candidate;
  }
  throw new Error(`Kit templates not found. Looked in: ${candidates.join(", ")}`);
}
function getKitVersion() {
  const pkg = JSON.parse(readFileSync5(join6(findPackageRoot(), "package.json"), "utf8"));
  if (!pkg.version)
    throw new Error("@hasna/contracts package.json has no version.");
  return pkg.version;
}
function tsHeader(version2) {
  return [
    "// @generated by @hasna/contracts vendor-kit \u2014 DO NOT EDIT.",
    `// KIT_VERSION: ${version2}`,
    "// Regenerate: bunx @hasna/contracts vendor-kit   Verify (CI): contracts vendor-kit --check",
    "",
    ""
  ].join(`
`);
}
function renderKitFile(file, version2, templatesDir = resolveTemplatesDir()) {
  const raw = readFileSync5(join6(templatesDir, file), "utf8");
  const withVersion = raw.split(KIT_VERSION_PLACEHOLDER).join(version2);
  if (file.endsWith(".ts"))
    return tsHeader(version2) + withVersion;
  return withVersion;
}
function sha256(content) {
  return `sha256:${createHash4("sha256").update(content.replace(/\r\n/g, `
`)).digest("hex")}`;
}
function renderKit(version2 = getKitVersion()) {
  const templatesDir = resolveTemplatesDir();
  const files = {};
  const manifestFiles = {};
  for (const file of KIT_TEMPLATE_FILES) {
    const content = renderKitFile(file, version2, templatesDir);
    files[file] = content;
    manifestFiles[file] = sha256(content);
  }
  const manifest = {
    generator: "@hasna/contracts vendor-kit",
    kitVersion: version2,
    files: manifestFiles
  };
  return { version: version2, files, manifest };
}
function generateKit(options) {
  const version2 = options.version ?? getKitVersion();
  const rendered = renderKit(version2);
  const targetDir = join6(resolve3(options.targetRepo), KIT_TARGET_SUBDIR);
  mkdirSync(targetDir, { recursive: true });
  const removed = [];
  for (const file of RETIRED_KIT_FILES) {
    const path = join6(targetDir, file);
    if (!existsSync3(path))
      continue;
    unlinkSync(path);
    removed.push(file);
  }
  const written = [];
  for (const file of KIT_TEMPLATE_FILES) {
    const content = rendered.files[file];
    if (content === undefined)
      continue;
    writeFileSync(join6(targetDir, file), content, "utf8");
    written.push(file);
  }
  writeFileSync(join6(targetDir, KIT_MANIFEST_FILE), JSON.stringify(rendered.manifest, null, 2) + `
`, "utf8");
  written.push(KIT_MANIFEST_FILE);
  let contractUpdated = false;
  if (options.writeContract !== false) {
    contractUpdated = writeKitVersionToContract(resolve3(options.targetRepo), version2);
  }
  return { version: version2, targetDir, written, removed, contractUpdated };
}
function writeKitVersionToContract(targetRepo, version2) {
  const contractPath = join6(targetRepo, "hasna.contract.json");
  if (!existsSync3(contractPath))
    return false;
  const contract = JSON.parse(readFileSync5(contractPath, "utf8"));
  if (contract.kitVersion === version2)
    return false;
  contract.kitVersion = version2;
  writeFileSync(contractPath, JSON.stringify(contract, null, 2) + `
`, "utf8");
  return true;
}
function checkKit(options) {
  const version2 = options.version ?? getKitVersion();
  const rendered = renderKit(version2);
  const targetDir = join6(resolve3(options.targetRepo), KIT_TARGET_SUBDIR);
  const files = [];
  for (const file of KIT_TEMPLATE_FILES) {
    const path = join6(targetDir, file);
    if (!existsSync3(path)) {
      files.push({ file, status: "missing" });
      continue;
    }
    const actual = sha256(readFileSync5(path, "utf8"));
    const expected = rendered.manifest.files[file];
    files.push({ file, status: actual === expected ? "ok" : "modified" });
  }
  const expectedNames = new Set([...KIT_TEMPLATE_FILES, KIT_MANIFEST_FILE]);
  const extras = [];
  if (existsSync3(targetDir)) {
    for (const entry of readdirSync3(targetDir)) {
      if (!expectedNames.has(entry))
        extras.push(entry);
    }
  }
  let staleVersion = null;
  let manifestKitVersion = null;
  const manifestPath = join6(targetDir, KIT_MANIFEST_FILE);
  if (existsSync3(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync5(manifestPath, "utf8"));
      manifestKitVersion = manifest.kitVersion;
      if (manifest.kitVersion !== version2)
        staleVersion = manifest.kitVersion;
    } catch {
      staleVersion = null;
    }
  }
  let depVersionMismatch = null;
  const declared = readDeclaredKitDependency(options.targetRepo);
  if (declared && staleVersion === null) {
    const kitVersion = manifestKitVersion ?? version2;
    const matches = kitMatchesDeclaredDependency(kitVersion, declared);
    if (matches === false) {
      depVersionMismatch = { kitVersion, declared };
    }
  }
  const ok = files.every((f) => f.status === "ok") && extras.length === 0 && staleVersion === null && depVersionMismatch === null;
  return { ok, version: version2, targetDir, files, extras, staleVersion, depVersionMismatch };
}

// src/cli/kit-runner.ts
function runVendorKit(targetRepo, options) {
  if (options.check) {
    runCheckKit(targetRepo, options);
    return;
  }
  const result = generateKit({
    targetRepo,
    ...options.kitVersion !== undefined ? { version: options.kitVersion } : {},
    writeContract: options.contract !== false
  });
  if (options.json) {
    console.log(JSON.stringify({ ok: true, action: "vendor", ...result }, null, 2));
  } else {
    console.log(`ok vendored storage-kit v${result.version} -> ${result.targetDir}`);
    console.log(`  files: ${result.written.join(", ")}`);
    console.log(`  hasna.contract.json kitVersion ${result.contractUpdated ? "updated" : "unchanged"}`);
  }
}
function runCheckKit(targetRepo, options) {
  const result = checkKit({
    targetRepo,
    ...options.kitVersion !== undefined ? { version: options.kitVersion } : {}
  });
  if (options.json) {
    console.log(JSON.stringify({ action: "check", ...result }, null, 2));
  } else {
    console.log(`${result.ok ? "ok" : "fail"} storage-kit check (expected v${result.version}) ${result.targetDir}`);
    for (const file of result.files) {
      if (file.status !== "ok")
        console.log(`  ${file.status} ${file.file}`);
    }
    for (const extra of result.extras) {
      console.log(`  unexpected ${extra}`);
    }
    if (result.staleVersion) {
      console.log(`  stale: on-disk kit is v${result.staleVersion}, regenerate to v${result.version}`);
    }
    if (result.depVersionMismatch) {
      const { kitVersion, declared } = result.depVersionMismatch;
      console.log(`  dep drift: kit v${kitVersion} but package.json declares "${declared}"`);
      console.log(`  align them: regenerate the kit or bump @hasna/contracts to the same minor line`);
    }
    if (!result.ok) {
      console.log("  run: bunx @hasna/contracts vendor-kit   (regenerate the kit)");
    }
  }
  if (!result.ok)
    process.exitCode = 1;
}

// src/auth/store.ts
var DEFAULT_API_KEYS_TABLE = "api_keys";
var API_KEY_ISSUANCE_PENDING_REASON = "credential_delivery_pending";
function createTableSql(table) {
  return `CREATE TABLE IF NOT EXISTS ${table} (
    kid TEXT PRIMARY KEY,
    app TEXT NOT NULL,
    agent TEXT,
    scopes JSONB NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    issued_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    revoked_reason TEXT,
    last_used_at TIMESTAMPTZ,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
}
function apiKeyMigrations(table = DEFAULT_API_KEYS_TABLE) {
  return [
    { id: `hasna_auth_0001_${table}`, sql: createTableSql(table) },
    {
      id: `hasna_auth_0002_${table}_indexes`,
      sql: `CREATE INDEX IF NOT EXISTS ${table}_app_idx ON ${table} (app);
            CREATE INDEX IF NOT EXISTS ${table}_token_hash_idx ON ${table} (token_hash);`
    },
    {
      id: `hasna_auth_0003_${table}_tenant`,
      sql: `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS tid TEXT;
            CREATE INDEX IF NOT EXISTS ${table}_tid_idx ON ${table} (tid);`
    }
  ];
}
function toIso(value) {
  if (value === null || value === undefined)
    return null;
  if (value instanceof Date)
    return value.toISOString();
  return new Date(String(value)).toISOString();
}
function parseScopes(value) {
  if (Array.isArray(value))
    return value.map((v) => String(v));
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
    } catch {
      return [];
    }
  }
  return [];
}
function rowToRecord(row) {
  const tid = ownTenantId(row);
  const agentValue = Object.hasOwn(row, "agent") ? row.agent : null;
  return {
    kid: String(row.kid),
    app: String(row.app),
    agent: agentValue === null || agentValue === undefined ? null : String(agentValue),
    tid: tid === null || tid === undefined ? null : String(tid),
    scopes: parseScopes(row.scopes),
    tokenHash: String(row.token_hash),
    issuedAt: toIso(row.issued_at) ?? new Date(0).toISOString(),
    expiresAt: toIso(row.expires_at),
    revokedAt: toIso(row.revoked_at),
    revokedReason: row.revoked_reason === null || row.revoked_reason === undefined ? null : String(row.revoked_reason),
    lastUsedAt: toIso(row.last_used_at),
    createdBy: row.created_by === null || row.created_by === undefined ? null : String(row.created_by)
  };
}

class ApiKeyStore {
  client;
  table;
  constructor(client, options = {}) {
    this.client = client;
    this.table = options.table ?? DEFAULT_API_KEYS_TABLE;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(this.table)) {
      throw new Error(`Invalid api-keys table name '${this.table}'.`);
    }
  }
  migrations() {
    return apiKeyMigrations(this.table);
  }
  async ensureSchema() {
    for (const migration of this.migrations()) {
      await this.client.execute(migration.sql);
    }
  }
  async insert(input) {
    await this.insertWithLifecycle(input, null, null);
  }
  async insertWithLifecycle(input, revokedAt, revokedReason) {
    const tid = ownTenantId(input);
    const agent = ownAgentClaim(input);
    await this.client.execute(`INSERT INTO ${this.table}
         (kid, app, agent, tid, scopes, token_hash, issued_at, expires_at, created_by, revoked_at, revoked_reason)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11)`, [
      input.kid,
      input.app,
      agent,
      tid === undefined || tid === null ? null : normalizeTenantId(tid),
      JSON.stringify(input.scopes),
      input.tokenHash,
      input.issuedAt.toISOString(),
      input.expiresAt ? input.expiresAt.toISOString() : null,
      input.createdBy ?? null,
      revokedAt,
      revokedReason
    ]);
  }
  mintedInput(minted, createdBy) {
    const claims = minted.claims;
    return {
      kid: minted.kid,
      app: claims.app,
      agent: ownAgentClaim(claims),
      tid: ownTenantId(claims) ?? null,
      scopes: claims.scopes,
      tokenHash: minted.tokenHash,
      issuedAt: new Date(claims.iat * 1000),
      expiresAt: claims.exp === null ? null : new Date(claims.exp * 1000),
      createdBy: createdBy ?? null
    };
  }
  async insertMinted(minted, createdBy) {
    await this.insert(this.mintedInput(minted, createdBy));
  }
  async insertMintedPending(minted, createdBy, atMs = Date.now()) {
    await this.insertWithLifecycle(this.mintedInput(minted, createdBy), new Date(atMs).toISOString(), API_KEY_ISSUANCE_PENDING_REASON);
  }
  async activatePending(kid, tokenHash) {
    const row = await this.client.get(`UPDATE ${this.table}
          SET revoked_at = NULL, revoked_reason = NULL
        WHERE kid = $1
          AND revoked_at IS NOT NULL
          AND revoked_reason = $2
          AND token_hash = $3
      RETURNING kid`, [kid, API_KEY_ISSUANCE_PENDING_REASON, tokenHash]);
    if (row)
      return true;
    const active = await this.client.get(`SELECT kid FROM ${this.table}
        WHERE kid = $1
          AND token_hash = $2
          AND revoked_at IS NULL
          AND revoked_reason IS NULL`, [kid, tokenHash]);
    return active !== null;
  }
  async findByKid(kid) {
    const row = await this.client.get(`SELECT * FROM ${this.table} WHERE kid = $1`, [kid]);
    return row ? rowToRecord(row) : null;
  }
  async findByTokenHash(tokenHash) {
    const row = await this.client.get(`SELECT * FROM ${this.table} WHERE token_hash = $1`, [tokenHash]);
    return row ? rowToRecord(row) : null;
  }
  isRevoked = async (kid) => {
    const row = await this.client.get(`SELECT revoked_at FROM ${this.table} WHERE kid = $1`, [kid]);
    if (!row)
      return false;
    return row.revoked_at !== null && row.revoked_at !== undefined;
  };
  async status(kid, nowMs = Date.now()) {
    const record = await this.findByKid(kid);
    if (!record)
      return "unknown";
    if (record.revokedAt)
      return "revoked";
    if (record.expiresAt && new Date(record.expiresAt).getTime() <= nowMs)
      return "expired";
    return "active";
  }
  keyStatus = async (kid) => {
    return this.status(kid);
  };
  statusChecker() {
    return async (kid) => {
      const status = await this.status(kid);
      return status !== "active";
    };
  }
  async revoke(kid, reason, atMs = Date.now()) {
    const row = await this.client.get(`UPDATE ${this.table}
          SET revoked_at = COALESCE(revoked_at, $2), revoked_reason = COALESCE(revoked_reason, $3)
        WHERE kid = $1
      RETURNING kid`, [kid, new Date(atMs).toISOString(), reason ?? null]);
    return row !== null;
  }
  async touchLastUsed(kid, atMs = Date.now()) {
    await this.client.execute(`UPDATE ${this.table} SET last_used_at = $2 WHERE kid = $1`, [
      kid,
      new Date(atMs).toISOString()
    ]);
  }
  async list(options = {}) {
    const clauses = [];
    const params = [];
    if (options.app) {
      params.push(options.app);
      clauses.push(`app = $${params.length}`);
    }
    const tid = ownTenantId(options);
    if (tid !== undefined) {
      params.push(normalizeTenantId(tid));
      clauses.push(`tid = $${params.length}`);
    }
    if (!options.includeRevoked) {
      clauses.push("revoked_at IS NULL");
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await this.client.many(`SELECT * FROM ${this.table} ${where} ORDER BY issued_at DESC`, params);
    return rows.map(rowToRecord);
  }
  async revokedKids() {
    const rows = await this.client.many(`SELECT kid FROM ${this.table} WHERE revoked_at IS NOT NULL`);
    return rows.map((row) => String(row.kid));
  }
}

// src/cli/secrets-bridge.ts
var SECRETS_PACKAGE_SPECIFIER = "@hasna/" + "secrets";
async function createSecretsBridgeClient(options) {
  const mod = await import(SECRETS_PACKAGE_SPECIFIER);
  return mod.createSecretsClientFromEnv({}, options);
}

// src/cli/issue-key.ts
var SAFE_REFERENCE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
var AGENT_REFERENCE_SEGMENT = "{agent}";
var KID_REFERENCE_SEGMENT = "{kid}";
var CANONICAL_SECRETS_URL_ENV = "HASNA_SECRETS_API_URL";
var CANONICAL_SECRETS_KEY_ENV = "HASNA_SECRETS_API_KEY";
var LEGACY_SECRETS_URL_ENV = "SECRETS_API_URL";
var LEGACY_SECRETS_KEY_ENV = "SECRETS_API_KEY";

class SecretsConfigurationError extends Error {
  code;
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "SecretsConfigurationError";
  }
}
function validateSecretsReferenceTemplate(value, agent) {
  if (typeof value !== "string") {
    throw new Error("--secrets-ref must be a string reference template.");
  }
  const template = value.trim();
  if (template.length === 0 || template.length > 256) {
    throw new Error("--secrets-ref must be 1-256 characters.");
  }
  if (!SAFE_REFERENCE_SEGMENT.test(agent)) {
    throw new Error("--agent must be a safe non-empty Secrets path segment (letters, digits, '.', '_' or '-').");
  }
  const segments = template.split("/");
  if (segments.length > 16 || segments.some((segment) => segment.length === 0)) {
    throw new Error("--secrets-ref must contain 1-16 non-empty path segments.");
  }
  const agentSegments = segments.filter((segment) => segment === AGENT_REFERENCE_SEGMENT).length;
  const kidSegments = segments.filter((segment) => segment === KID_REFERENCE_SEGMENT).length;
  if (agentSegments !== 1 || kidSegments !== 1) {
    throw new Error("--secrets-ref must contain exactly one '{agent}' segment and one '{kid}' segment.");
  }
  for (const segment of segments) {
    if (segment === AGENT_REFERENCE_SEGMENT || segment === KID_REFERENCE_SEGMENT)
      continue;
    if (!SAFE_REFERENCE_SEGMENT.test(segment)) {
      throw new Error("--secrets-ref contains an unsafe path segment.");
    }
  }
  return {
    resolve: (kid) => segments.map((segment) => segment === AGENT_REFERENCE_SEGMENT ? agent : segment === KID_REFERENCE_SEGMENT ? kid : segment).join("/")
  };
}
function ownEnv(env, key) {
  const value = Object.hasOwn(env, key) ? env[key] : undefined;
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
function normalizeSecretsBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new SecretsConfigurationError("invalid_secrets_config");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:" || url.username.length > 0 || url.password.length > 0 || url.pathname !== "/" || url.search.length > 0 || url.hash.length > 0) {
    throw new SecretsConfigurationError("invalid_secrets_config");
  }
  return url.origin;
}
function resolveSecretsAlias(env, urlEnv, keyEnv) {
  const rawUrl = ownEnv(env, urlEnv);
  const rawApiKey = ownEnv(env, keyEnv);
  if (!rawUrl && !rawApiKey)
    return;
  if (!rawUrl || !rawApiKey || rawApiKey !== rawApiKey.trim()) {
    throw new SecretsConfigurationError("invalid_secrets_config");
  }
  return { baseUrl: normalizeSecretsBaseUrl(rawUrl), apiKey: rawApiKey };
}
function resolveSecretsServiceConfig(env) {
  const canonical = resolveSecretsAlias(env, CANONICAL_SECRETS_URL_ENV, CANONICAL_SECRETS_KEY_ENV);
  const legacy = resolveSecretsAlias(env, LEGACY_SECRETS_URL_ENV, LEGACY_SECRETS_KEY_ENV);
  if (!canonical && !legacy)
    throw new SecretsConfigurationError("missing_secrets_config");
  if (canonical && legacy && (canonical.baseUrl !== legacy.baseUrl || canonical.apiKey !== legacy.apiKey)) {
    throw new SecretsConfigurationError("conflicting_secrets_config");
  }
  return canonical ?? legacy;
}
async function connectSecrets(config2) {
  return createSecretsBridgeClient(config2);
}
async function closeQuietly(handle) {
  if (!handle)
    return;
  try {
    await handle.close();
  } catch {}
}
async function compensateRecord(store, kid) {
  if (!store.revoke)
    return false;
  try {
    await store.revoke(kid, "credential_delivery_failed");
    return true;
  } catch {
    return false;
  }
}
async function compensateSecret(client, key) {
  try {
    await client.deleteSecret({ key });
    return true;
  } catch {
    return false;
  }
}
function envToken2(app) {
  return app.toUpperCase().replace(/-/g, "_");
}
function signingSecretEnvName(app, override) {
  return override ?? `HASNA_${envToken2(app)}_API_SIGNING_KEY`;
}
function databaseUrlEnvName(app, override) {
  return override ?? `HASNA_${envToken2(app)}_DATABASE_URL`;
}
function ownOption2(options, name) {
  return Object.hasOwn(options, name) ? options[name] : undefined;
}
function parseScopesCsv(csv) {
  if (typeof csv !== "string")
    return [];
  return csv.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}
function validateIssuanceId(value) {
  if (typeof value !== "string" || value !== value.trim() || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new Error("--issuance-id must be a safe 1-64 character key id (letters, digits, '_' or '-').");
  }
  return value;
}
function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function existingIssuanceMatches(record, request) {
  const issuedAtMs = Date.parse(record.issuedAt);
  const expiresAtMs = record.expiresAt === null ? null : Date.parse(record.expiresAt);
  if (!Number.isFinite(issuedAtMs) || expiresAtMs !== null && !Number.isFinite(expiresAtMs))
    return false;
  const storedTtlSeconds = expiresAtMs === null ? null : Math.floor((expiresAtMs - issuedAtMs) / 1000);
  return record.app === request.app && record.agent === request.agent && record.tid === (request.tid ?? null) && record.createdBy === request.agent && storedTtlSeconds === request.ttlSeconds && sameStrings(record.scopes, request.scopes);
}
async function hasExactSecretMetadata(client, key) {
  if (!client.listSecrets)
    return false;
  const result = await client.listSecrets({ namespace: key });
  return result.secrets?.some((metadata) => metadata.key === key && metadata.type === "api_key") === true;
}
async function activateIdempotently(store, issuance) {
  if (!store.activatePending)
    return false;
  try {
    return await store.activatePending(issuance.kid, issuance.tokenHash);
  } catch {
    return store.activatePending(issuance.kid, issuance.tokenHash);
  }
}
function emitSilentReceipt(json, receipt) {
  const output = {
    ok: true,
    ...receipt,
    issuanceId: receipt.kid,
    stored: true,
    vaultStored: true
  };
  if (json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  console.log(`Issued API key metadata for app '${receipt.app}' (kid ${receipt.kid})`);
  console.log(`  agent:      ${receipt.agent}`);
  console.log(`  tenant:     ${receipt.tid ?? "- (untenanted)"}`);
  console.log(`  scopes:     ${receipt.scopes.join(", ")}`);
  console.log(`  issued:     ${receipt.issuedAt}`);
  console.log(`  expires:    ${receipt.expiresAt ?? "never"}`);
  console.log(`  secretsRef: ${receipt.secretsRef}`);
}
async function connectStore(connectionString, table) {
  let pgModule;
  try {
    pgModule = await Promise.resolve().then(() => (init_esm(), exports_esm));
  } catch {
    throw new Error("Persisting the key record requires the 'pg' package. Install it, or pass --no-store.");
  }
  const Pool2 = pgModule.default?.Pool ?? pgModule.Pool;
  const pool = new Pool2({ connectionString });
  const client = {
    many: async (sql, params) => (await pool.query(sql, params)).rows,
    get: async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null,
    execute: async (sql, params) => {
      await pool.query(sql, params);
    }
  };
  const store = new ApiKeyStore(client, { table });
  return { store, close: () => pool.end() };
}
async function runIssueKey(options, deps) {
  const env = deps.env ?? process.env;
  const optJson = ownOption2(options, "json");
  const optApp = ownOption2(options, "app");
  const optBootstrap = ownOption2(options, "bootstrap");
  const optScopes = ownOption2(options, "scopes");
  const optAgent = ownOption2(options, "agent");
  const optTid = ownOption2(options, "tid");
  const optExpiry = ownOption2(options, "expiry");
  const optTtlDays = ownOption2(options, "ttlDays");
  const optSigningSecretEnv = ownOption2(options, "signingSecretEnv");
  const optDatabaseUrlEnv = ownOption2(options, "databaseUrlEnv");
  const optTable = ownOption2(options, "table");
  const optStore = ownOption2(options, "store");
  const optSecretsRef = ownOption2(options, "secretsRef");
  const optIssuanceId = ownOption2(options, "issuanceId");
  const json = optJson === true;
  const app = String(optApp ?? "").trim();
  if (!app) {
    deps.report({ json }, "Missing required option --app.", { code: "missing_app" });
    return;
  }
  const bootstrap = optBootstrap === true;
  let scopes = parseScopesCsv(optScopes);
  if (scopes.length === 0) {
    if (bootstrap) {
      scopes = [`${app}:*`];
    } else {
      deps.report({ json }, "Missing --scopes. Provide e.g. --scopes 'todos:read,todos:write' or use --bootstrap.", {
        code: "missing_scopes"
      });
      return;
    }
  }
  const agent = optAgent !== undefined ? String(optAgent) : bootstrap ? "bootstrap" : undefined;
  let secretsReference;
  let secretsConfig;
  let issuanceId;
  if (optIssuanceId !== undefined && optSecretsRef === undefined) {
    deps.report({ json }, "--issuance-id is supported only with credential-safe --secrets-ref issuance.", {
      code: "bad_issuance_id"
    });
    return;
  }
  if (optSecretsRef !== undefined) {
    if (bootstrap || typeof optAgent !== "string" || optAgent.trim().length === 0) {
      deps.report({ json }, "Credential-safe Secrets issuance requires an explicit --agent.", {
        code: "missing_agent"
      });
      return;
    }
    if (optStore === false) {
      deps.report({ json }, "--secrets-ref cannot be combined with --no-store.", {
        code: "bad_secrets_store_mode"
      });
      return;
    }
    if (optIssuanceId !== undefined) {
      try {
        issuanceId = validateIssuanceId(optIssuanceId);
      } catch (error2) {
        deps.report({ json }, error2 instanceof Error ? error2.message : "Invalid --issuance-id.", {
          code: "bad_issuance_id"
        });
        return;
      }
    }
    try {
      secretsReference = validateSecretsReferenceTemplate(optSecretsRef, agent);
      secretsConfig = resolveSecretsServiceConfig(env);
    } catch (error2) {
      if (error2 instanceof SecretsConfigurationError) {
        deps.report({ json }, "Could not resolve one unambiguous Hasna Secrets service configuration.", {
          code: error2.code
        });
        return;
      }
      const message = error2 instanceof Error ? error2.message : "Invalid --secrets-ref.";
      deps.report({ json }, message, { code: "bad_secrets_ref" });
      return;
    }
  }
  let tid;
  if (optTid !== undefined) {
    try {
      tid = normalizeTenantId(String(optTid));
    } catch (error2) {
      const message = error2 instanceof Error ? error2.message : String(error2);
      deps.report({ json }, message, { code: "bad_tid" });
      return;
    }
  }
  let ttlSeconds;
  if (optExpiry === false) {
    ttlSeconds = null;
  } else {
    const days = optTtlDays !== undefined ? Number(optTtlDays) : 90;
    if (!Number.isFinite(days) || days <= 0) {
      deps.report({ json }, "--ttl-days must be a positive number.", { code: "bad_ttl" });
      return;
    }
    ttlSeconds = Math.floor(days * 24 * 60 * 60);
  }
  const secretEnvName = signingSecretEnvName(app, optSigningSecretEnv);
  const fallbackName = optSigningSecretEnv ? undefined : "HASNA_API_SIGNING_KEY";
  const signingSecret = (env[secretEnvName] ?? (fallbackName ? env[fallbackName] : undefined))?.trim();
  if (!signingSecret) {
    const tried = fallbackName ? `${secretEnvName} (or ${fallbackName})` : secretEnvName;
    deps.report({ json }, `No signing secret found. Set the ${tried} env var (openssl rand -hex 32).`, {
      code: "missing_signing_secret",
      signingSecretEnv: secretEnvName
    });
    return;
  }
  let minted;
  let issuanceNowMs;
  try {
    issuanceNowMs = deps.now ? deps.now() : undefined;
    minted = mintApiKey({
      app,
      scopes,
      signingSecret,
      ttlSeconds,
      ...agent !== undefined ? { agent } : {},
      ...tid !== undefined ? { tid } : {},
      ...issuanceId !== undefined ? { kid: issuanceId } : {},
      ...issuanceNowMs !== undefined ? { nowMs: issuanceNowMs } : {}
    });
  } catch (error2) {
    const message = error2 instanceof Error ? error2.message : String(error2);
    deps.report({ json }, `Could not mint key: ${message}`, { code: "mint_failed" });
    return;
  }
  const table = optTable ?? "api_keys";
  const dbEnvName = databaseUrlEnvName(app, optDatabaseUrlEnv);
  const expiresAt = minted.claims.exp === null ? null : new Date(minted.claims.exp * 1000).toISOString();
  const issuedAt = new Date(minted.claims.iat * 1000).toISOString();
  if (secretsReference) {
    const secretsRef = secretsReference.resolve(minted.kid);
    const createdBy = agent;
    const connectionString = env[dbEnvName];
    if (!connectionString) {
      deps.report({ json }, `No database URL found. Set ${dbEnvName}.`, {
        code: "missing_database_url",
        databaseUrlEnv: dbEnvName
      });
      return;
    }
    let handle;
    let secretsClient;
    let storageReady = false;
    try {
      const connect = deps.connectStore ?? connectStore;
      handle = await connect(connectionString, table);
      await handle.store.ensureSchema();
      if (!handle.store.revoke || !handle.store.insertMintedPending || !handle.store.activatePending) {
        deps.report({ json }, "The selected key store does not support fail-closed compensation.", {
          code: "bad_secrets_store_contract"
        });
        return;
      }
      if (issuanceId && !handle.store.findByKid) {
        deps.report({ json }, "The selected key store does not support idempotent issuance reconciliation.", {
          code: "bad_secrets_store_contract"
        });
        return;
      }
      const connectVault = deps.connectSecrets ?? connectSecrets;
      secretsClient = await connectVault(secretsConfig);
      if (issuanceId && !secretsClient.listSecrets) {
        deps.report({ json }, "The selected Secrets client does not support metadata-only issuance reconciliation.", {
          code: "bad_secrets_store_contract"
        });
        return;
      }
      storageReady = true;
    } catch {
      deps.report({ json }, "Could not prepare credential-safe key storage.", {
        code: "storage_prepare_failed"
      });
      return;
    } finally {
      if (!storageReady)
        await closeQuietly(handle);
    }
    if (issuanceId) {
      let existing;
      try {
        existing = await handle.store.findByKid(minted.kid);
      } catch {
        deps.report({ json }, "Could not inspect the existing credential issuance.", {
          code: "issuance_reconciliation_failed",
          app,
          kid: minted.kid,
          issuanceId: minted.kid,
          agent: createdBy,
          secretsRef
        });
        await closeQuietly(handle);
        return;
      }
      if (existing) {
        const matches = existingIssuanceMatches(existing, {
          app,
          agent: createdBy,
          tid,
          scopes: minted.claims.scopes,
          ttlSeconds
        });
        if (!matches) {
          deps.report({ json }, "The issuance id is already bound to a different credential request.", {
            code: "issuance_conflict",
            app,
            kid: minted.kid,
            issuanceId: minted.kid,
            agent: createdBy,
            secretsRef
          });
          await closeQuietly(handle);
          return;
        }
        let vaultPresent = false;
        try {
          vaultPresent = await hasExactSecretMetadata(secretsClient, secretsRef);
        } catch {}
        const pending = existing.revokedAt !== null && existing.revokedReason === API_KEY_ISSUANCE_PENDING_REASON;
        let active = existing.revokedAt === null && existing.revokedReason === null;
        if (pending && vaultPresent) {
          try {
            active = await activateIdempotently(handle.store, existing);
          } catch {
            active = false;
          }
        }
        const expired = existing.expiresAt !== null && Date.parse(existing.expiresAt) <= (issuanceNowMs ?? Date.now());
        if (!active || !vaultPresent || expired) {
          deps.report({ json }, "Could not reconcile the existing credential issuance to one usable record and vault row.", {
            code: "issuance_reconciliation_failed",
            app,
            kid: existing.kid,
            issuanceId: existing.kid,
            agent: createdBy,
            secretsRef
          });
          await closeQuietly(handle);
          return;
        }
        await closeQuietly(handle);
        emitSilentReceipt(json, {
          app,
          kid: existing.kid,
          agent: createdBy,
          tid: existing.tid,
          scopes: existing.scopes,
          issuedAt: existing.issuedAt,
          expiresAt: existing.expiresAt,
          secretsRef
        });
        return;
      }
    }
    try {
      await handle.store.insertMintedPending(minted, createdBy);
    } catch {
      if (issuanceId) {
        let concurrent = null;
        try {
          concurrent = await handle.store.findByKid(minted.kid);
        } catch {}
        if (concurrent) {
          deps.report({ json }, "The credential issuance is already in progress; retry the same issuance id.", {
            code: "issuance_in_progress",
            app,
            kid: minted.kid,
            issuanceId: minted.kid,
            agent: createdBy,
            secretsRef
          });
          await closeQuietly(handle);
          return;
        }
      }
      const compensated = await compensateRecord(handle.store, minted.kid);
      deps.report({ json }, "Could not persist the credential record.", {
        code: "store_failed",
        app,
        kid: minted.kid,
        issuanceId: minted.kid,
        agent: createdBy,
        secretsRef,
        compensated
      });
      await closeQuietly(handle);
      return;
    }
    try {
      const metadata = await secretsClient.putSecret({
        key: secretsRef,
        value: minted.token,
        type: "api_key",
        label: `${app} API key for ${createdBy}`
      });
      if (metadata.key !== secretsRef || metadata.type !== "api_key") {
        throw new Error("Secrets metadata did not match the requested reference.");
      }
      const activated = await activateIdempotently(handle.store, minted);
      if (!activated)
        throw new Error("The pending credential record could not be activated.");
    } catch {
      const recordCompensated = await compensateRecord(handle.store, minted.kid);
      const vaultCompensated = await compensateSecret(secretsClient, secretsRef);
      const compensated = recordCompensated && vaultCompensated;
      deps.report({ json }, "Could not store the credential in Hasna Secrets.", {
        code: "secrets_store_failed",
        app,
        kid: minted.kid,
        issuanceId: minted.kid,
        agent: createdBy,
        secretsRef,
        compensated,
        recordCompensated,
        vaultCompensated
      });
      await closeQuietly(handle);
      return;
    }
    await closeQuietly(handle);
    emitSilentReceipt(json, {
      app,
      kid: minted.kid,
      agent: createdBy,
      tid: tid ?? null,
      scopes: minted.claims.scopes,
      issuedAt,
      expiresAt,
      secretsRef
    });
    return;
  }
  const keyMaterial = {
    app,
    kid: minted.kid,
    agent: agent ?? null,
    tid: tid ?? null,
    scopes,
    issuedAt,
    expiresAt,
    tokenHash: minted.tokenHash,
    bootstrap,
    token: minted.token
  };
  const printKeyBlock = (record, storeError) => {
    console.log(`Issued API key for app '${app}' (kid ${minted.kid})${bootstrap ? " [bootstrap]" : ""}`);
    console.log(`  scopes:    ${scopes.join(", ")}`);
    console.log(`  agent:     ${agent ?? "-"}`);
    console.log(`  tenant:    ${tid ?? "- (untenanted)"}`);
    console.log(`  issued:    ${issuedAt}`);
    console.log(`  expires:   ${expiresAt ?? "never"}`);
    console.log(`  record:    ${record}`);
    if (storeError)
      console.log(`  storeError: ${storeError}`);
    console.log(`  tokenHash: ${minted.tokenHash}`);
    if (!stored) {
      console.log("");
      console.log("  WARNING: no api_keys record was stored for this key. Services that verify");
      console.log("  key status (the default: keyStatus/statusChecker) will REFUSE it with");
      console.log("  reason 'unknown_key', and it CANNOT BE REVOKED \u2014 revocation works by");
      console.log(`  writing revoked_at on the '${table}' row, and there is no row. Register it`);
      console.log("  with ApiKeyStore.insertMinted, or re-issue with the database URL set.");
    }
    if (expiresAt === null) {
      console.log("");
      console.log("  WARNING: this key NEVER EXPIRES. Fleet TTL policy is expiring keys");
      console.log("  (default 90 days); a leaked forever-key stays valid until someone");
      console.log("  notices. Prefer --ttl-days and rotate on schedule.");
    }
    console.log("");
    console.log("  API key (shown once \u2014 copy it now, it cannot be recovered):");
    console.log(`  ${minted.token}`);
  };
  const reportStoreFailure = (message, code, details = {}) => {
    deps.report({ json }, message, { code, ...details, stored: false, ...keyMaterial });
    if (!json)
      printKeyBlock("NOT STORED", message);
  };
  let stored = false;
  if (optStore !== false) {
    const createdBy = agent ?? "issue-key";
    const connectionString = env[dbEnvName];
    if (!connectionString) {
      reportStoreFailure(`No database URL found. Set ${dbEnvName}, or pass --no-store to skip persistence.`, "missing_database_url", { databaseUrlEnv: dbEnvName });
      return;
    }
    let handle;
    try {
      const connect = deps.connectStore ?? connectStore;
      handle = await connect(connectionString, table);
      await handle.store.ensureSchema();
      await handle.store.insertMinted(minted, createdBy);
      stored = true;
    } catch (error2) {
      const message = error2 instanceof Error ? error2.message : String(error2);
      reportStoreFailure(`Could not persist key record: ${message}`, "store_failed");
      return;
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch {}
      }
    }
  }
  if (json) {
    const warnings = [];
    if (!stored) {
      warnings.push("unregistered: no api_keys record stored \u2014 strict services (keyStatus/statusChecker) will refuse this key with reason 'unknown_key', and it cannot be revoked until a record exists");
    }
    if (expiresAt === null) {
      warnings.push("no_expiry: this key never expires; fleet TTL policy is expiring keys (default 90 days)");
    }
    console.log(JSON.stringify({ ok: true, ...keyMaterial, stored, revocable: stored, warnings }, null, 2));
    return;
  }
  printKeyBlock(stored ? `stored (${table})` : "not stored (--no-store)", null);
}

// src/artifact-scan.ts
import { createHash as createHash5, randomBytes as randomBytes2 } from "crypto";
import { existsSync as existsSync4, readFileSync as readFileSync6, readdirSync as readdirSync4, rmSync as rmSync2, statSync as statSync4 } from "fs";
import { basename as basename2, join as join7, relative as relative4 } from "path";

// src/tlds.ts
var IANA_TLDS = [
  "aaa",
  "aarp",
  "abb",
  "abbott",
  "abbvie",
  "abc",
  "able",
  "abogado",
  "abudhabi",
  "ac",
  "academy",
  "accenture",
  "accountant",
  "accountants",
  "aco",
  "actor",
  "ad",
  "ads",
  "adult",
  "ae",
  "aeg",
  "aero",
  "aetna",
  "af",
  "afl",
  "africa",
  "ag",
  "agakhan",
  "agency",
  "ai",
  "aig",
  "airbus",
  "airforce",
  "airtel",
  "akdn",
  "al",
  "alibaba",
  "alipay",
  "allfinanz",
  "allstate",
  "ally",
  "alsace",
  "alstom",
  "am",
  "amazon",
  "americanexpress",
  "americanfamily",
  "amex",
  "amfam",
  "amica",
  "amsterdam",
  "analytics",
  "android",
  "anquan",
  "anz",
  "ao",
  "aol",
  "apartments",
  "app",
  "apple",
  "aq",
  "aquarelle",
  "ar",
  "arab",
  "aramco",
  "archi",
  "army",
  "arpa",
  "art",
  "arte",
  "as",
  "asda",
  "asia",
  "associates",
  "at",
  "athleta",
  "attorney",
  "au",
  "auction",
  "audi",
  "audible",
  "audio",
  "auspost",
  "author",
  "auto",
  "autos",
  "aw",
  "aws",
  "ax",
  "axa",
  "az",
  "azure",
  "ba",
  "baby",
  "baidu",
  "banamex",
  "band",
  "bank",
  "bar",
  "barcelona",
  "barclaycard",
  "barclays",
  "barefoot",
  "bargains",
  "baseball",
  "basketball",
  "bauhaus",
  "bayern",
  "bb",
  "bbc",
  "bbt",
  "bbva",
  "bcg",
  "bcn",
  "bd",
  "be",
  "beats",
  "beauty",
  "beer",
  "berlin",
  "best",
  "bestbuy",
  "bet",
  "bf",
  "bg",
  "bh",
  "bharti",
  "bi",
  "bible",
  "bid",
  "bike",
  "bing",
  "bingo",
  "bio",
  "biz",
  "bj",
  "black",
  "blackfriday",
  "blockbuster",
  "blog",
  "bloomberg",
  "blue",
  "bm",
  "bms",
  "bmw",
  "bn",
  "bnpparibas",
  "bo",
  "boats",
  "boehringer",
  "bofa",
  "bom",
  "bond",
  "boo",
  "book",
  "booking",
  "bosch",
  "bostik",
  "boston",
  "bot",
  "boutique",
  "box",
  "br",
  "bradesco",
  "bridgestone",
  "broadway",
  "broker",
  "brother",
  "brussels",
  "bs",
  "bt",
  "build",
  "builders",
  "business",
  "buy",
  "buzz",
  "bv",
  "bw",
  "by",
  "bz",
  "bzh",
  "ca",
  "cab",
  "cafe",
  "cal",
  "call",
  "calvinklein",
  "cam",
  "camera",
  "camp",
  "canon",
  "capetown",
  "capital",
  "capitalone",
  "car",
  "caravan",
  "cards",
  "care",
  "career",
  "careers",
  "cars",
  "casa",
  "case",
  "cash",
  "casino",
  "cat",
  "catering",
  "catholic",
  "cba",
  "cbn",
  "cbre",
  "cc",
  "cd",
  "center",
  "ceo",
  "cern",
  "cf",
  "cfa",
  "cfd",
  "cg",
  "ch",
  "chanel",
  "channel",
  "charity",
  "chase",
  "chat",
  "cheap",
  "chintai",
  "christmas",
  "chrome",
  "church",
  "ci",
  "cipriani",
  "circle",
  "cisco",
  "citadel",
  "citi",
  "citic",
  "city",
  "ck",
  "cl",
  "claims",
  "cleaning",
  "click",
  "clinic",
  "clinique",
  "clothing",
  "cloud",
  "club",
  "clubmed",
  "cm",
  "cn",
  "co",
  "coach",
  "codes",
  "coffee",
  "college",
  "cologne",
  "com",
  "commbank",
  "community",
  "company",
  "compare",
  "computer",
  "comsec",
  "condos",
  "construction",
  "consulting",
  "contact",
  "contractors",
  "cooking",
  "cool",
  "coop",
  "corsica",
  "country",
  "coupon",
  "coupons",
  "courses",
  "cpa",
  "cr",
  "credit",
  "creditcard",
  "creditunion",
  "cricket",
  "crown",
  "crs",
  "cruise",
  "cruises",
  "cu",
  "cuisinella",
  "cv",
  "cw",
  "cx",
  "cy",
  "cymru",
  "cyou",
  "cz",
  "dad",
  "dance",
  "data",
  "date",
  "dating",
  "datsun",
  "day",
  "dclk",
  "dds",
  "de",
  "deal",
  "dealer",
  "deals",
  "degree",
  "delivery",
  "dell",
  "deloitte",
  "delta",
  "democrat",
  "dental",
  "dentist",
  "desi",
  "design",
  "dev",
  "dhl",
  "diamonds",
  "diet",
  "digital",
  "direct",
  "directory",
  "discount",
  "discover",
  "dish",
  "diy",
  "dj",
  "dk",
  "dm",
  "dnp",
  "do",
  "docs",
  "doctor",
  "dog",
  "domains",
  "dot",
  "download",
  "drive",
  "dtv",
  "dubai",
  "dupont",
  "durban",
  "dvag",
  "dvr",
  "dz",
  "earth",
  "eat",
  "ec",
  "eco",
  "edeka",
  "edu",
  "education",
  "ee",
  "eg",
  "email",
  "emerck",
  "energy",
  "engineer",
  "engineering",
  "enterprises",
  "epson",
  "equipment",
  "er",
  "ericsson",
  "erni",
  "es",
  "esq",
  "estate",
  "et",
  "eu",
  "eurovision",
  "eus",
  "events",
  "exchange",
  "expert",
  "exposed",
  "express",
  "extraspace",
  "fage",
  "fail",
  "fairwinds",
  "faith",
  "family",
  "fan",
  "fans",
  "farm",
  "farmers",
  "fashion",
  "fast",
  "fedex",
  "feedback",
  "ferrari",
  "ferrero",
  "fi",
  "fidelity",
  "fido",
  "film",
  "final",
  "finance",
  "financial",
  "fire",
  "firestone",
  "firmdale",
  "fish",
  "fishing",
  "fit",
  "fitness",
  "fj",
  "fk",
  "flickr",
  "flights",
  "flir",
  "florist",
  "flowers",
  "fly",
  "fm",
  "fo",
  "foo",
  "food",
  "football",
  "ford",
  "forex",
  "forsale",
  "forum",
  "foundation",
  "fox",
  "fr",
  "free",
  "fresenius",
  "frl",
  "frogans",
  "frontier",
  "ftr",
  "fujitsu",
  "fun",
  "fund",
  "furniture",
  "futbol",
  "fyi",
  "ga",
  "gal",
  "gallery",
  "gallo",
  "gallup",
  "game",
  "games",
  "gap",
  "garden",
  "gay",
  "gb",
  "gbiz",
  "gd",
  "gdn",
  "ge",
  "gea",
  "gent",
  "genting",
  "george",
  "gf",
  "gg",
  "ggee",
  "gh",
  "gi",
  "gift",
  "gifts",
  "gives",
  "giving",
  "gl",
  "glass",
  "gle",
  "global",
  "globo",
  "gm",
  "gmail",
  "gmbh",
  "gmo",
  "gmx",
  "gn",
  "godaddy",
  "gold",
  "goldpoint",
  "golf",
  "goodyear",
  "goog",
  "google",
  "gop",
  "got",
  "gov",
  "gp",
  "gq",
  "gr",
  "grainger",
  "graphics",
  "gratis",
  "green",
  "gripe",
  "grocery",
  "group",
  "gs",
  "gt",
  "gu",
  "gucci",
  "guge",
  "guide",
  "guitars",
  "guru",
  "gw",
  "gy",
  "hair",
  "hamburg",
  "hangout",
  "haus",
  "hbo",
  "hdfc",
  "hdfcbank",
  "health",
  "healthcare",
  "help",
  "helsinki",
  "here",
  "hermes",
  "hiphop",
  "hisamitsu",
  "hitachi",
  "hiv",
  "hk",
  "hkt",
  "hm",
  "hn",
  "hockey",
  "holdings",
  "holiday",
  "homedepot",
  "homegoods",
  "homes",
  "homesense",
  "honda",
  "horse",
  "hospital",
  "host",
  "hosting",
  "hot",
  "hotels",
  "hotmail",
  "house",
  "how",
  "hr",
  "hsbc",
  "ht",
  "hu",
  "hughes",
  "hyatt",
  "hyundai",
  "ibm",
  "icbc",
  "ice",
  "icu",
  "id",
  "ie",
  "ieee",
  "ifm",
  "ikano",
  "il",
  "im",
  "imamat",
  "imdb",
  "immo",
  "immobilien",
  "in",
  "inc",
  "industries",
  "infiniti",
  "info",
  "ing",
  "ink",
  "institute",
  "insurance",
  "insure",
  "int",
  "international",
  "intuit",
  "investments",
  "io",
  "ipiranga",
  "iq",
  "ir",
  "irish",
  "is",
  "ismaili",
  "ist",
  "istanbul",
  "it",
  "itau",
  "itv",
  "jaguar",
  "java",
  "jcb",
  "je",
  "jeep",
  "jetzt",
  "jewelry",
  "jio",
  "jll",
  "jm",
  "jmp",
  "jnj",
  "jo",
  "jobs",
  "joburg",
  "jot",
  "joy",
  "jp",
  "jpmorgan",
  "jprs",
  "juegos",
  "juniper",
  "kaufen",
  "kddi",
  "ke",
  "kerryhotels",
  "kerryproperties",
  "kfh",
  "kg",
  "kh",
  "ki",
  "kia",
  "kids",
  "kim",
  "kindle",
  "kitchen",
  "kiwi",
  "km",
  "kn",
  "koeln",
  "komatsu",
  "kosher",
  "kp",
  "kpmg",
  "kpn",
  "kr",
  "krd",
  "kred",
  "kuokgroup",
  "kw",
  "ky",
  "kyoto",
  "kz",
  "la",
  "lacaixa",
  "lamborghini",
  "lamer",
  "land",
  "landrover",
  "lanxess",
  "lasalle",
  "lat",
  "latino",
  "latrobe",
  "law",
  "lawyer",
  "lb",
  "lc",
  "lds",
  "lease",
  "leclerc",
  "lefrak",
  "legal",
  "lego",
  "lexus",
  "lgbt",
  "li",
  "lidl",
  "life",
  "lifeinsurance",
  "lifestyle",
  "lighting",
  "like",
  "lilly",
  "limited",
  "limo",
  "lincoln",
  "link",
  "live",
  "living",
  "lk",
  "llc",
  "llp",
  "loan",
  "loans",
  "locker",
  "locus",
  "lol",
  "london",
  "lotte",
  "lotto",
  "love",
  "lpl",
  "lplfinancial",
  "lr",
  "ls",
  "lt",
  "ltd",
  "ltda",
  "lu",
  "lundbeck",
  "luxe",
  "luxury",
  "lv",
  "ly",
  "ma",
  "madrid",
  "maif",
  "maison",
  "makeup",
  "man",
  "management",
  "mango",
  "map",
  "market",
  "marketing",
  "markets",
  "marriott",
  "marshalls",
  "mattel",
  "mba",
  "mc",
  "mckinsey",
  "md",
  "me",
  "med",
  "media",
  "meet",
  "melbourne",
  "meme",
  "memorial",
  "men",
  "menu",
  "merck",
  "merckmsd",
  "mg",
  "mh",
  "miami",
  "microsoft",
  "mil",
  "mini",
  "mint",
  "mit",
  "mitsubishi",
  "mk",
  "ml",
  "mlb",
  "mls",
  "mm",
  "mma",
  "mn",
  "mo",
  "mobi",
  "mobile",
  "moda",
  "moe",
  "moi",
  "mom",
  "monash",
  "money",
  "monster",
  "mormon",
  "mortgage",
  "moscow",
  "moto",
  "motorcycles",
  "mov",
  "movie",
  "mp",
  "mq",
  "mr",
  "ms",
  "msd",
  "mt",
  "mtn",
  "mtr",
  "mu",
  "museum",
  "music",
  "mv",
  "mw",
  "mx",
  "my",
  "mz",
  "na",
  "nab",
  "nagoya",
  "name",
  "navy",
  "nba",
  "nc",
  "ne",
  "nec",
  "net",
  "netbank",
  "netflix",
  "network",
  "neustar",
  "new",
  "news",
  "next",
  "nextdirect",
  "nexus",
  "nf",
  "nfl",
  "ng",
  "ngo",
  "nhk",
  "ni",
  "nico",
  "nike",
  "nikon",
  "ninja",
  "nissan",
  "nissay",
  "nl",
  "no",
  "nokia",
  "norton",
  "now",
  "nowruz",
  "nowtv",
  "np",
  "nr",
  "nra",
  "nrw",
  "ntt",
  "nu",
  "nyc",
  "nz",
  "obi",
  "observer",
  "office",
  "okinawa",
  "olayan",
  "olayangroup",
  "ollo",
  "om",
  "omega",
  "one",
  "ong",
  "onl",
  "online",
  "ooo",
  "open",
  "oracle",
  "orange",
  "org",
  "organic",
  "origins",
  "osaka",
  "otsuka",
  "ott",
  "ovh",
  "pa",
  "page",
  "panasonic",
  "paris",
  "pars",
  "partners",
  "parts",
  "party",
  "pay",
  "pccw",
  "pe",
  "pet",
  "pf",
  "pfizer",
  "pg",
  "ph",
  "pharmacy",
  "phd",
  "philips",
  "phone",
  "photo",
  "photography",
  "photos",
  "physio",
  "pics",
  "pictet",
  "pictures",
  "pid",
  "pin",
  "ping",
  "pink",
  "pioneer",
  "pizza",
  "pk",
  "pl",
  "place",
  "play",
  "playstation",
  "plumbing",
  "plus",
  "pm",
  "pn",
  "pnc",
  "pohl",
  "poker",
  "politie",
  "porn",
  "post",
  "pr",
  "praxi",
  "press",
  "prime",
  "pro",
  "prod",
  "productions",
  "prof",
  "progressive",
  "promo",
  "properties",
  "property",
  "protection",
  "pru",
  "prudential",
  "ps",
  "pt",
  "pub",
  "pw",
  "pwc",
  "py",
  "qa",
  "qpon",
  "quebec",
  "quest",
  "racing",
  "radio",
  "re",
  "read",
  "realestate",
  "realtor",
  "realty",
  "recipes",
  "red",
  "redumbrella",
  "rehab",
  "reise",
  "reisen",
  "reit",
  "reliance",
  "ren",
  "rent",
  "rentals",
  "repair",
  "report",
  "republican",
  "rest",
  "restaurant",
  "review",
  "reviews",
  "rexroth",
  "rich",
  "richardli",
  "ricoh",
  "ril",
  "rio",
  "rip",
  "ro",
  "rocks",
  "rodeo",
  "rogers",
  "room",
  "rs",
  "rsvp",
  "ru",
  "rugby",
  "ruhr",
  "run",
  "rw",
  "rwe",
  "ryukyu",
  "sa",
  "saarland",
  "safe",
  "safety",
  "sakura",
  "sale",
  "salon",
  "samsclub",
  "samsung",
  "sandvik",
  "sandvikcoromant",
  "sanofi",
  "sap",
  "sarl",
  "sas",
  "save",
  "saxo",
  "sb",
  "sbi",
  "sbs",
  "sc",
  "scb",
  "schaeffler",
  "schmidt",
  "scholarships",
  "school",
  "schule",
  "schwarz",
  "science",
  "scot",
  "sd",
  "se",
  "search",
  "seat",
  "secure",
  "security",
  "seek",
  "select",
  "sener",
  "services",
  "seven",
  "sew",
  "sex",
  "sexy",
  "sfr",
  "sg",
  "sh",
  "shangrila",
  "sharp",
  "shell",
  "shia",
  "shiksha",
  "shoes",
  "shop",
  "shopping",
  "shouji",
  "show",
  "si",
  "silk",
  "sina",
  "singles",
  "site",
  "sj",
  "sk",
  "ski",
  "skin",
  "sky",
  "skype",
  "sl",
  "sling",
  "sm",
  "smart",
  "smile",
  "sn",
  "sncf",
  "so",
  "soccer",
  "social",
  "softbank",
  "software",
  "sohu",
  "solar",
  "solutions",
  "song",
  "sony",
  "soy",
  "spa",
  "space",
  "sport",
  "spot",
  "sr",
  "srl",
  "ss",
  "st",
  "stada",
  "staples",
  "star",
  "statebank",
  "statefarm",
  "stc",
  "stcgroup",
  "stockholm",
  "storage",
  "store",
  "stream",
  "studio",
  "study",
  "style",
  "su",
  "sucks",
  "supplies",
  "supply",
  "support",
  "surf",
  "surgery",
  "suzuki",
  "sv",
  "swatch",
  "swiss",
  "sx",
  "sy",
  "sydney",
  "systems",
  "sz",
  "tab",
  "taipei",
  "talk",
  "taobao",
  "target",
  "tatamotors",
  "tatar",
  "tattoo",
  "tax",
  "taxi",
  "tc",
  "tci",
  "td",
  "tdk",
  "team",
  "tech",
  "technology",
  "tel",
  "temasek",
  "tennis",
  "teva",
  "tf",
  "tg",
  "th",
  "thd",
  "theater",
  "theatre",
  "tiaa",
  "tickets",
  "tienda",
  "tips",
  "tires",
  "tirol",
  "tj",
  "tjmaxx",
  "tjx",
  "tk",
  "tkmaxx",
  "tl",
  "tm",
  "tmall",
  "tn",
  "to",
  "today",
  "tokyo",
  "tools",
  "top",
  "toray",
  "toshiba",
  "total",
  "tours",
  "town",
  "toyota",
  "toys",
  "tr",
  "trade",
  "trading",
  "training",
  "travel",
  "travelers",
  "travelersinsurance",
  "trust",
  "trv",
  "tt",
  "tube",
  "tui",
  "tunes",
  "tushu",
  "tv",
  "tvs",
  "tw",
  "tz",
  "ua",
  "ubank",
  "ubs",
  "ug",
  "uk",
  "unicom",
  "university",
  "uno",
  "uol",
  "ups",
  "us",
  "uy",
  "uz",
  "va",
  "vacations",
  "vana",
  "vanguard",
  "vc",
  "ve",
  "vegas",
  "ventures",
  "verisign",
  "versicherung",
  "vet",
  "vg",
  "vi",
  "viajes",
  "video",
  "vig",
  "viking",
  "villas",
  "vin",
  "vip",
  "virgin",
  "visa",
  "vision",
  "viva",
  "vivo",
  "vlaanderen",
  "vn",
  "vodka",
  "volvo",
  "vote",
  "voting",
  "voto",
  "voyage",
  "vu",
  "wales",
  "walmart",
  "walter",
  "wang",
  "wanggou",
  "watch",
  "watches",
  "weather",
  "weatherchannel",
  "web",
  "webcam",
  "weber",
  "website",
  "wed",
  "wedding",
  "weibo",
  "weir",
  "wf",
  "whoswho",
  "wien",
  "wiki",
  "williamhill",
  "win",
  "windows",
  "wine",
  "winners",
  "wme",
  "woodside",
  "work",
  "works",
  "world",
  "wow",
  "ws",
  "wtc",
  "wtf",
  "xbox",
  "xerox",
  "xihuan",
  "xin",
  "xn--11b4c3d",
  "xn--1ck2e1b",
  "xn--1qqw23a",
  "xn--2scrj9c",
  "xn--30rr7y",
  "xn--3bst00m",
  "xn--3ds443g",
  "xn--3e0b707e",
  "xn--3hcrj9c",
  "xn--3pxu8k",
  "xn--42c2d9a",
  "xn--45br5cyl",
  "xn--45brj9c",
  "xn--45q11c",
  "xn--4dbrk0ce",
  "xn--4gbrim",
  "xn--54b7fta0cc",
  "xn--55qw42g",
  "xn--55qx5d",
  "xn--5su34j936bgsg",
  "xn--5tzm5g",
  "xn--6frz82g",
  "xn--6qq986b3xl",
  "xn--80adxhks",
  "xn--80ao21a",
  "xn--80aqecdr1a",
  "xn--80asehdb",
  "xn--80aswg",
  "xn--8y0a063a",
  "xn--90a3ac",
  "xn--90ae",
  "xn--90ais",
  "xn--9dbq2a",
  "xn--9et52u",
  "xn--9krt00a",
  "xn--b4w605ferd",
  "xn--bck1b9a5dre4c",
  "xn--c1avg",
  "xn--c2br7g",
  "xn--cck2b3b",
  "xn--cckwcxetd",
  "xn--cg4bki",
  "xn--clchc0ea0b2g2a9gcd",
  "xn--czr694b",
  "xn--czrs0t",
  "xn--czru2d",
  "xn--d1acj3b",
  "xn--d1alf",
  "xn--e1a4c",
  "xn--eckvdtc9d",
  "xn--efvy88h",
  "xn--fct429k",
  "xn--fhbei",
  "xn--fiq228c5hs",
  "xn--fiq64b",
  "xn--fiqs8s",
  "xn--fiqz9s",
  "xn--fjq720a",
  "xn--flw351e",
  "xn--fpcrj9c3d",
  "xn--fzc2c9e2c",
  "xn--fzys8d69uvgm",
  "xn--g2xx48c",
  "xn--gckr3f0f",
  "xn--gecrj9c",
  "xn--gk3at1e",
  "xn--h2breg3eve",
  "xn--h2brj9c",
  "xn--h2brj9c8c",
  "xn--hxt814e",
  "xn--i1b6b1a6a2e",
  "xn--imr513n",
  "xn--io0a7i",
  "xn--j1aef",
  "xn--j1amh",
  "xn--j6w193g",
  "xn--jlq480n2rg",
  "xn--jvr189m",
  "xn--kcrx77d1x4a",
  "xn--kprw13d",
  "xn--kpry57d",
  "xn--kput3i",
  "xn--l1acc",
  "xn--lgbbat1ad8j",
  "xn--mgb9awbf",
  "xn--mgba3a3ejt",
  "xn--mgba3a4f16a",
  "xn--mgba7c0bbn0a",
  "xn--mgbaam7a8h",
  "xn--mgbab2bd",
  "xn--mgbah1a3hjkrd",
  "xn--mgbai9azgqp6j",
  "xn--mgbayh7gpa",
  "xn--mgbbh1a",
  "xn--mgbbh1a71e",
  "xn--mgbc0a9azcg",
  "xn--mgbca7dzdo",
  "xn--mgbcpq6gpa1a",
  "xn--mgberp4a5d4ar",
  "xn--mgbgu82a",
  "xn--mgbi4ecexp",
  "xn--mgbpl2fh",
  "xn--mgbt3dhd",
  "xn--mgbtx2b",
  "xn--mgbx4cd0ab",
  "xn--mix891f",
  "xn--mk1bu44c",
  "xn--mxtq1m",
  "xn--ngbc5azd",
  "xn--ngbe9e0a",
  "xn--ngbrx",
  "xn--node",
  "xn--nqv7f",
  "xn--nqv7fs00ema",
  "xn--nyqy26a",
  "xn--o3cw4h",
  "xn--ogbpf8fl",
  "xn--otu796d",
  "xn--p1acf",
  "xn--p1ai",
  "xn--pgbs0dh",
  "xn--pssy2u",
  "xn--q7ce6a",
  "xn--q9jyb4c",
  "xn--qcka1pmc",
  "xn--qxa6a",
  "xn--qxam",
  "xn--rhqv96g",
  "xn--rovu88b",
  "xn--rvc1e0am3e",
  "xn--s9brj9c",
  "xn--ses554g",
  "xn--t60b56a",
  "xn--tckwe",
  "xn--tiq49xqyj",
  "xn--unup4y",
  "xn--vermgensberater-ctb",
  "xn--vermgensberatung-pwb",
  "xn--vhquv",
  "xn--vuq861b",
  "xn--w4r85el8fhu5dnra",
  "xn--w4rs40l",
  "xn--wgbh1c",
  "xn--wgbl6a",
  "xn--xhq521b",
  "xn--xkc2al3hye2a",
  "xn--xkc2dl3a5ee0h",
  "xn--y9a3aq",
  "xn--yfro4i67o",
  "xn--ygbi2ammx",
  "xn--zfr164b",
  "xxx",
  "xyz",
  "yachts",
  "yahoo",
  "yamaxun",
  "yandex",
  "ye",
  "yodobashi",
  "yoga",
  "yokohama",
  "you",
  "youtube",
  "yt",
  "yun",
  "za",
  "zappos",
  "zara",
  "zero",
  "zip",
  "zm",
  "zone",
  "zuerich",
  "zw"
];
var PROGRAMMING_COLLISION_TLDS = new Set([
  "actor",
  "email",
  "events",
  "fail",
  "health",
  "help",
  "id",
  "link",
  "map",
  "md",
  "name",
  "next",
  "post",
  "read",
  "sh",
  "shell",
  "tools",
  "watch"
]);
var RECOGNIZED_TLDS = new Set(IANA_TLDS.filter((tld) => !PROGRAMMING_COLLISION_TLDS.has(tld)));
function isRecognizedTld(label) {
  return RECOGNIZED_TLDS.has(label.toLowerCase());
}

// src/artifact-scan.ts
var ASSET_INVENTORY_KINDS2 = ["domain", "host", "ip", "email"];
var DEFAULT_INVENTORY_THRESHOLDS = Object.freeze({
  domain: 20,
  host: 25,
  ip: 20,
  email: 15
});
var RESERVED_TLDS = new Set(["test", "example", "invalid", "localhost", "local", "internal", "onion", "arpa"]);
var RESERVED_DOMAINS = new Set(["example.com", "example.net", "example.org", "localhost"]);
var REGISTRY_SECOND_LEVELS = Object.freeze({
  uk: ["co", "org", "ac", "gov", "me", "net", "sch"],
  au: ["com", "net", "org", "edu", "gov"],
  nz: ["co", "net", "org"],
  jp: ["co", "or", "ne", "ac", "go"],
  br: ["com", "net", "org"],
  in: ["co", "net", "org"],
  cn: ["com", "net", "org", "gov"],
  za: ["co", "org"],
  kr: ["co", "or"],
  mx: ["com"],
  ar: ["com"],
  tr: ["com"],
  sg: ["com"],
  hk: ["com"],
  tw: ["com"]
});
var MULTI_LABEL_SUFFIXES = new Set(Object.entries(REGISTRY_SECOND_LEVELS).flatMap(([tld, seconds]) => seconds.map((second) => [second, tld].join("."))));
var QUOTED_LITERAL_PATTERN = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
var LITERAL_SEPARATORS = /[\s,;|]+/;
var FIELD_SEPARATORS = /[,|\t]/;
var MIN_COLUMN_RUN = 5;
var MIN_LITERAL_RUN = 5;
var LITERAL_RUN_GLUE = /^[\s,;:=|<>+\-\w$[\]{}]*$/;
var LABEL_LITERAL = /^[^.@\n]{1,80}$/;
var URL_AUTHORITY_PREFIX = /^(?:[a-z][a-z0-9+.-]*:)?\/\//;
var URL_AUTHORITY_END = /[/?#]/;
var HOST_PORT_SUFFIX = /:\d{1,5}$/;
var HOSTNAME_LITERAL = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
var EMAIL_LITERAL = /^[a-z0-9._%+-]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
var IPV4_LITERAL = /^(?:(?:0|[1-9]\d{0,2})\.){3}(?:0|[1-9]\d{0,2})$/;
var VERSION_KEY = /(?:^|[_.-])(?:v8|node|chrome|chromium|electron|engine|firefox|safari|opera|edge|ie|deno|bun|npm|yarn|pnpm|python|ruby|java|dotnet|semver|ver|version|revision|build|sdk|runtime|target|min|max)(?:[_.-]|$)/i;
function isVersionKey(key) {
  if (isCountableHostname(key.toLowerCase()))
    return false;
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return VERSION_KEY.test(normalized);
}
function enclosingKey(view, literalStart) {
  const before = view.slice(Math.max(0, literalStart - 96), literalStart);
  const match = /(?:"([^"\n]{1,64})"|'([^'\n]{1,64})'|([A-Za-z_$][\w$-]{0,63}))\s*:\s*$/.exec(before);
  return match ? match[1] ?? match[2] ?? match[3] ?? null : null;
}
var IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
function addressCandidates(view, codeLike) {
  const found = [];
  for (const match of view.matchAll(QUOTED_LITERAL_PATTERN)) {
    const literal2 = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!IPV4_LITERAL.test(literal2))
      continue;
    if (codeLike) {
      const key = enclosingKey(view, match.index ?? 0);
      if (key !== null && isVersionKey(key))
        continue;
    }
    found.push(literal2);
  }
  if (!codeLike) {
    for (const match of view.matchAll(IPV4_PATTERN)) {
      if (IPV4_LITERAL.test(match[0]))
        found.push(match[0]);
    }
  }
  return found;
}
function isReservedIpv4(value) {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return true;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224)
    return true;
  if (a === 100 && b >= 64 && b <= 127)
    return true;
  if (a === 169 && b === 254)
    return true;
  if (a === 172 && b >= 16 && b <= 31)
    return true;
  if (a === 192 && b === 168)
    return true;
  if (a === 192 && b === 0 && c === 2)
    return true;
  if (a === 198 && (b === 18 || b === 19))
    return true;
  if (a === 198 && b === 51 && c === 100)
    return true;
  if (a === 203 && b === 0 && c === 113)
    return true;
  return false;
}
function isReservedHostname(hostname2) {
  const lower = hostname2.toLowerCase();
  if (RESERVED_DOMAINS.has(lower))
    return true;
  const tld = lower.slice(lower.lastIndexOf(".") + 1);
  if (RESERVED_TLDS.has(tld))
    return true;
  return [...RESERVED_DOMAINS].some((reserved) => lower.endsWith(`.${reserved}`));
}
function registrableDomain(hostname2) {
  const labels = hostname2.toLowerCase().split(".");
  if (labels.length <= 2)
    return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  return MULTI_LABEL_SUFFIXES.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}
var MAX_INVENTORY_THRESHOLDS = Object.freeze({
  domain: 40,
  host: 50,
  ip: 40,
  email: 30
});
function clampThresholds(requested) {
  const clamped = { ...requested };
  for (const kind of ASSET_INVENTORY_KINDS2) {
    const value = clamped[kind];
    if (!Number.isFinite(value) || value < 1) {
      throw new Error(`${kind} threshold must be a positive number.`);
    }
    if (value > MAX_INVENTORY_THRESHOLDS[kind]) {
      throw new Error(`${kind} threshold ${value} exceeds the ${MAX_INVENTORY_THRESHOLDS[kind]} ceiling. A threshold that high disables the detector, which is the gate being switched off through its own front door.`);
    }
  }
  return clamped;
}
function redact(entry, kind) {
  return `<${kind}:${reportDigest(entry)}>`;
}
var REPORT_SALT = randomBytes2(16);
function reportDigest(value) {
  return createHash5("sha256").update(REPORT_SALT).update(value, "utf8").digest("hex").slice(0, 8);
}
function decodeMember(bytes) {
  const utf8 = bytes.toString("utf8");
  return utf8.includes("\uFFFD") ? bytes.toString("latin1") : utf8;
}
function distinct(values) {
  return [...new Set(values)].sort();
}
function decodeEscapes(value) {
  const codePoint = (encoded, radix) => {
    const parsed = Number.parseInt(encoded, radix);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1114111)
      return null;
    return String.fromCodePoint(parsed);
  };
  const SIMPLE = {
    n: `
`,
    r: "\r",
    t: "\t",
    b: "\b",
    f: "\f",
    v: "\v",
    "0": "\x00",
    '"': '"',
    "'": "'",
    "`": "`",
    "\\": "\\",
    "/": "/"
  };
  const decoded = value.replace(/\\u\{([0-9a-f]{1,6})\}|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})|\\([\s\S])/gi, (match, braced, fourHex, twoHex, single) => {
    if (braced !== undefined)
      return codePoint(braced, 16) ?? match;
    if (fourHex !== undefined)
      return codePoint(fourHex, 16) ?? match;
    if (twoHex !== undefined)
      return codePoint(twoHex, 16) ?? match;
    return single !== undefined ? SIMPLE[single] ?? match : match;
  });
  return decoded.replace(/%([0-9a-f]{2})/gi, (match, hex) => codePoint(hex, 16) ?? match).replace(/&#x([0-9a-f]+);?/gi, (match, hex) => codePoint(hex, 16) ?? match).replace(/&#([0-9]+);?/g, (match, dec) => codePoint(dec, 10) ?? match);
}
function decodedViews(text) {
  const views = [text];
  const escaped = decodeEscapes(text);
  if (escaped !== text)
    views.push(escaped);
  const carriesAsset = /[a-z0-9]\.[a-z]/i;
  for (const match of text.matchAll(/[A-Za-z0-9+/]{64,}={0,2}/g)) {
    const token = match[0];
    if (token.length % 4 === 1)
      continue;
    const decoded = Buffer.from(token, "base64").toString("utf8");
    if (carriesAsset.test(decoded))
      views.push(decoded);
  }
  for (const match of text.matchAll(/\b[0-9a-f]{64,}\b/gi)) {
    const token = match[0].length % 2 === 0 ? match[0] : match[0].slice(0, -1);
    const decoded = Buffer.from(token, "hex").toString("utf8");
    if (carriesAsset.test(decoded))
      views.push(decoded);
  }
  return views;
}
function isCountableHostname(value) {
  if (!HOSTNAME_LITERAL.test(value))
    return false;
  if (isReservedHostname(value))
    return false;
  return isRecognizedTld(value.slice(value.lastIndexOf(".") + 1));
}
function isCountableEmail(value) {
  if (!EMAIL_LITERAL.test(value))
    return false;
  const domain = value.slice(value.indexOf("@") + 1);
  if (isReservedHostname(domain))
    return false;
  return isRecognizedTld(domain.slice(domain.lastIndexOf(".") + 1));
}
function hostComponent(piece) {
  const prefix = URL_AUTHORITY_PREFIX.exec(piece);
  if (!prefix)
    return piece.replace(HOST_PORT_SUFFIX, "").replace(/\.$/, "");
  let authority = piece.slice(prefix[0].length);
  const end = authority.search(URL_AUTHORITY_END);
  if (end >= 0)
    authority = authority.slice(0, end);
  const userinfo = authority.lastIndexOf("@");
  if (userinfo >= 0)
    authority = authority.slice(userinfo + 1);
  return authority.replace(HOST_PORT_SUFFIX, "").replace(/\.$/, "");
}
function countableAsset(piece) {
  const normalized = piece.toLowerCase();
  if (isCountableEmail(normalized))
    return normalized;
  const host = hostComponent(normalized);
  return isCountableHostname(host) ? host : null;
}
function record(asset, hosts, emails) {
  (isCountableEmail(asset) ? emails : hosts).add(asset);
}
var CODE_EXTENSIONS = new Set([
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "tsx",
  "mts",
  "cts",
  "json",
  "map",
  "css",
  "scss",
  "html",
  "vue",
  "svelte"
]);
function isCodeLikeMember(path) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0)
    return false;
  return CODE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}
function isMemberAccessRun(run) {
  const twoLabel = run.filter((entry) => entry.asset.split(".").length === 2);
  if (twoLabel.length !== run.length)
    return false;
  const firstLabels = new Set(twoLabel.map((entry) => entry.asset.slice(0, entry.asset.indexOf("."))));
  if (firstLabels.size !== 1)
    return false;
  const tlds = new Set(twoLabel.map((entry) => entry.asset.slice(entry.asset.lastIndexOf(".") + 1)));
  return tlds.size === twoLabel.length;
}
function collectLineInventories(text, hosts, emails, codeLike) {
  let run = [];
  const closeRun = () => {
    if (run.length >= MIN_LITERAL_RUN && !(codeLike && isMemberAccessRun(run))) {
      for (const entry of run)
        record(entry.asset, hosts, emails);
    }
    run = [];
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const stripped = rawLine.trim().replace(/^[-*+#>\s]+/, "").replace(/^\d+[.):,]?\s*/, "").replace(/^[A-Za-z0-9_-]{1,40}\s*:\s*/, "").trim();
    if (!stripped) {
      continue;
    }
    const line = stripped.replace(/^[\['"`(]+|[\]'"`),;]+$/g, "").trim();
    const asset = line ? countableAsset(line) : null;
    if (asset) {
      run.push({ asset });
      continue;
    }
    closeRun();
  }
  closeRun();
}
function collectDelimitedRun(text, hosts, emails) {
  const pieces = text.split(LITERAL_SEPARATORS).filter(Boolean);
  if (pieces.length < MIN_LITERAL_RUN)
    return;
  const assets = pieces.map(countableAsset);
  const countable = assets.filter((asset) => asset !== null);
  if (countable.length < MIN_LITERAL_RUN)
    return;
  if (countable.length * 2 < pieces.length)
    return;
  for (const asset of countable)
    record(asset, hosts, emails);
}
function collectLiteralInventories(text, hosts, emails, depth = 0) {
  let run = [];
  let previousEnd = -1;
  const closeRun = () => {
    if (run.length >= MIN_LITERAL_RUN)
      for (const asset of run)
        record(asset, hosts, emails);
    run = [];
  };
  for (const match of text.matchAll(QUOTED_LITERAL_PATTERN)) {
    const start = match.index ?? 0;
    const sibling = previousEnd >= 0 && LITERAL_RUN_GLUE.test(text.slice(previousEnd, start));
    previousEnd = start + match[0].length;
    const raw = match[1] ?? match[2] ?? match[3] ?? "";
    const literal2 = raw.replace(/\\(["'`\\])/g, "$1").trim();
    if (depth < 2 && /["'`]/.test(literal2)) {
      collectLiteralInventories(literal2, hosts, emails, depth + 1);
    }
    const pieces = literal2 ? literal2.split(LITERAL_SEPARATORS).map((piece) => piece.replace(/^[\[\]{}()"'`]+|[\[\]{}()"'`;,]+$/g, "")).filter(Boolean) : [];
    const assets = pieces.map(countableAsset).filter((asset) => asset !== null);
    const [first] = assets;
    if (!sibling)
      closeRun();
    if (first === undefined) {
      if (literal2.length < 3)
        continue;
      if (IPV4_LITERAL.test(literal2))
        continue;
      if (!LABEL_LITERAL.test(literal2))
        closeRun();
      continue;
    }
    if (pieces.length === 1) {
      run.push(first);
      continue;
    }
    closeRun();
    if (assets.length * 2 >= pieces.length)
      for (const asset of assets)
        record(asset, hosts, emails);
  }
  closeRun();
}
function collectColumnInventories(text, hosts, emails) {
  const runs = new Map;
  const close = (column) => {
    const values = runs.get(column);
    runs.delete(column);
    if (!values || values.length < MIN_COLUMN_RUN)
      return;
    for (const value of values)
      record(value, hosts, emails);
  };
  for (const line of text.split(/\r?\n/)) {
    const fields = line.split(FIELD_SEPARATORS);
    const populated = fields.filter((field) => field.trim() !== "").length;
    const trimmed = line.trim();
    const carried = new Set;
    for (const [column, field] of fields.entries()) {
      const value = field.trim();
      const asset = countableAsset(value);
      if (asset === null)
        continue;
      if (populated < 2 && trimmed !== value)
        continue;
      carried.add(column);
      const run = runs.get(column);
      if (run)
        run.push(asset);
      else
        runs.set(column, [asset]);
    }
    for (const column of [...runs.keys()])
      if (!carried.has(column))
        close(column);
  }
  for (const column of [...runs.keys()])
    close(column);
}
function inventoryCounts(text, options = {}) {
  const codeLike = options.codeLike ?? true;
  const emails = new Set;
  const hosts = new Set;
  const views = decodedViews(text);
  for (const [index, view] of views.entries()) {
    collectLiteralInventories(view, hosts, emails);
    collectColumnInventories(view, hosts, emails);
    collectLineInventories(view, hosts, emails, codeLike && index === 0);
    if (index > 0)
      collectDelimitedRun(view, hosts, emails);
  }
  const emailHosts = new Set([...emails].map((email2) => email2.slice(email2.indexOf("@") + 1)));
  const named = [...hosts].filter((host) => !emailHosts.has(host)).sort();
  const domains = distinct(named.map(registrableDomain));
  const hostList = named.filter((host) => host !== registrableDomain(host));
  const ips = distinct(views.flatMap((view) => addressCandidates(view, codeLike)).filter((ip) => !isReservedIpv4(ip)));
  return { domain: domains, host: hostList, ip: ips, email: [...emails].sort() };
}
function readError(error2) {
  return error2 instanceof Error ? error2.message : String(error2);
}
function* readDirectoryMembers(root, maxMemberBytes, dir = root) {
  const skipDirs = new Set([".git", "node_modules"]);
  for (const entry of readdirSync4(dir, { withFileTypes: true })) {
    const full = join7(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name))
        yield* readDirectoryMembers(root, maxMemberBytes, full);
      continue;
    }
    if (!entry.isFile())
      continue;
    const path = relative4(root, full).replaceAll("\\", "/");
    const size = statSync4(full).size;
    if (size > maxMemberBytes) {
      yield { path, reason: `${size} bytes exceeds the ${maxMemberBytes}-byte scan ceiling` };
      continue;
    }
    try {
      yield { path, bytes: readFileSync6(full) };
    } catch (error2) {
      yield { path, reason: readError(error2) };
    }
  }
}
function* readArchiveMembers(target, maxMemberBytes) {
  let extracted;
  try {
    extracted = extractArchive(target);
  } catch (error2) {
    yield { path: basename2(target), reason: `archive could not be extracted: ${readError(error2)}` };
    return;
  }
  try {
    const root = existsSync4(join7(extracted, "package")) ? join7(extracted, "package") : extracted;
    yield* readDirectoryMembers(root, maxMemberBytes);
  } finally {
    rmSync2(extracted, { recursive: true, force: true });
  }
}
function scanPublishedArtifact(target, options = {}) {
  const stat = statSync4(target);
  const scanMode = stat.isDirectory() ? "source_tree" : isPackedArtifactPath(target) ? "packed_artifact" : "packed_artifact";
  if (!stat.isDirectory() && !isPackedArtifactPath(target)) {
    throw new Error("Artifact scan target must be a directory, .tgz, or .tar.gz file.");
  }
  const maxMemberBytes = options.maxMemberBytes ?? MAX_SCANNED_MEMBER_BYTES;
  const members = stat.isDirectory() ? readDirectoryMembers(target, maxMemberBytes) : readArchiveMembers(target, maxMemberBytes);
  const thresholds = clampThresholds({ ...DEFAULT_INVENTORY_THRESHOLDS, ...options.thresholds });
  const waived = new Set(options.waivedKinds ?? []);
  const ignore = new Set(options.ignorePaths ?? []);
  const findings = [];
  const waivedFindings = [];
  const aggregateFindings = [];
  const unreadable = [];
  const union2 = {
    domain: new Set,
    host: new Set,
    ip: new Set,
    email: new Set
  };
  let seen = 0;
  let scanned = 0;
  let excludedByCaller = 0;
  for (const member of members) {
    seen += 1;
    if (ignore.has(member.path)) {
      excludedByCaller += 1;
      continue;
    }
    if ("reason" in member) {
      unreadable.push({ path: member.path, reason: member.reason });
      continue;
    }
    scanned += 1;
    const counts = inventoryCounts(decodeMember(member.bytes), {
      codeLike: isCodeLikeMember(member.path)
    });
    for (const kind of ASSET_INVENTORY_KINDS2) {
      const entries = counts[kind];
      for (const entry of entries)
        union2[kind].add(entry);
      const threshold = thresholds[kind];
      if (entries.length < threshold)
        continue;
      const finding = {
        path: member.path,
        kind,
        count: entries.length,
        threshold,
        sample: entries.slice(0, 3).map((entry) => redact(entry, kind))
      };
      (waived.has(kind) ? waivedFindings : findings).push(finding);
    }
  }
  for (const kind of ASSET_INVENTORY_KINDS2) {
    const entries = [...union2[kind]].sort();
    const threshold = thresholds[kind];
    if (entries.length < threshold)
      continue;
    if (findings.some((finding2) => finding2.kind === kind))
      continue;
    if (waivedFindings.some((finding2) => finding2.kind === kind))
      continue;
    const finding = {
      path: "<artifact>",
      kind,
      count: entries.length,
      threshold,
      sample: entries.slice(0, 3).map((entry) => redact(entry, kind))
    };
    aggregateFindings.push(finding);
    (waived.has(kind) ? waivedFindings : findings).push(finding);
  }
  if (scanned === 0) {
    throw new Error(`Artifact scan read zero members from ${basename2(target)} (${seen} seen, ${excludedByCaller} excluded). Refusing to report a clean verdict on nothing.`);
  }
  return {
    ok: findings.length === 0 && unreadable.length === 0,
    target,
    scanMode,
    membersScanned: scanned,
    membersSkipped: excludedByCaller,
    findings,
    aggregateFindings,
    waived: waivedFindings,
    unreadable
  };
}
function formatArtifactScanReport(report) {
  const lines = [
    `${report.ok ? "pass" : "FAIL"} artifact-scan ${basename2(report.target)} (${report.scanMode}, ${report.membersScanned} members scanned, ${report.membersSkipped} excluded, ${report.unreadable.length} unreadable)`
  ];
  for (const finding of report.findings) {
    lines.push(`  FAIL ${finding.path}: ${finding.count} distinct ${finding.kind} entries (threshold ${finding.threshold}) e.g. ${finding.sample.join(", ")}`);
  }
  for (const member of report.unreadable) {
    lines.push(`  FAIL ${member.path}: could not be read, so it has not been cleared (${member.reason})`);
  }
  for (const finding of report.waived) {
    lines.push(`  waived ${finding.path}: ${finding.count} distinct ${finding.kind} entries`);
  }
  return lines.join(`
`);
}
function isAssetInventoryKind(value) {
  return typeof value === "string" && ASSET_INVENTORY_KINDS2.includes(value);
}
function readDeclaredWaiver(value) {
  if (typeof value !== "object" || value === null)
    return "waiver entry is not an object";
  const declared = value;
  const { kind, reason, reviewedBy, expiresAt } = declared;
  if (!isAssetInventoryKind(kind)) {
    return `waiver kind ${JSON.stringify(kind)} is not one of ${ASSET_INVENTORY_KINDS2.join(", ")}`;
  }
  if (typeof reason !== "string" || reason.trim() === "")
    return `waiver for ${kind} names no reason`;
  if (typeof reviewedBy !== "string" || reviewedBy.trim() === "")
    return `waiver for ${kind} names no reviewer`;
  if (typeof expiresAt !== "string" || Number.isNaN(Date.parse(expiresAt)))
    return `waiver for ${kind} has no usable expiresAt`;
  return { kind, reason, reviewedBy, expiresAt };
}
function resolveAssetInventoryWaivers(manifestPath, now = new Date) {
  if (!existsSync4(manifestPath))
    return { kinds: [], notes: [] };
  let manifest;
  try {
    manifest = JSON.parse(readFileSync6(manifestPath, "utf8"));
  } catch (error2) {
    throw new Error(`Could not read asset-inventory waivers from ${manifestPath}: ${readError(error2)}`);
  }
  const conformance = manifest?.metadata?.conformance;
  const declared = conformance?.waivedAssetInventories;
  if (declared === undefined)
    return { kinds: [], notes: [] };
  if (!Array.isArray(declared)) {
    return { kinds: [], notes: ["metadata.conformance.waivedAssetInventories is not an array; no waiver applied"] };
  }
  const kinds = [];
  const notes = [];
  for (const entry of declared) {
    const waiver = readDeclaredWaiver(entry);
    if (typeof waiver === "string") {
      notes.push(`${waiver}; not applied`);
      continue;
    }
    if (Date.parse(waiver.expiresAt) <= now.getTime()) {
      notes.push(`${waiver.kind} waiver expired at ${waiver.expiresAt}; not applied`);
      continue;
    }
    if (!kinds.includes(waiver.kind))
      kinds.push(waiver.kind);
    notes.push(`${waiver.kind} waived until ${waiver.expiresAt} (reviewed by ${waiver.reviewedBy}): ${waiver.reason}`);
  }
  return { kinds, notes };
}

// src/safe-read-exec.ts
import { spawnSync } from "child_process";
import { closeSync, mkdtempSync as mkdtempSync2, openSync, readFileSync as readFileSync7, rmSync as rmSync3 } from "fs";
import { tmpdir as tmpdir2 } from "os";
import { join as join8 } from "path";

// src/safe-read.ts
var ROWS_KEY_CANDIDATES = [
  "rows",
  "entries",
  "items",
  "results",
  "records",
  "tasks",
  "messages",
  "data"
];
var TOTAL_KEY_CANDIDATES = ["total", "total_count", "totalCount", "totalItems", "total_available"];
var STDERR_TRUNCATION_PATTERNS = [
  { re: /showing\s+(\d+)\s+of\s+(\d+)/i, note: "surface reported a bounded read" },
  { re: /\btruncated\b/i, note: "surface used the word truncated" },
  { re: /to see the rest/i, note: "surface offered a route to the remainder" },
  { re: /page with --cursor/i, note: "surface offered a cursor" }
];
function isPlainObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isUsableCursor(value) {
  return typeof value === "string" && value.trim().length > 0 || typeof value === "number" && Number.isSafeInteger(value);
}
function locateRows(parsed, rowsKey) {
  if (Array.isArray(parsed)) {
    return { ok: true, rows: parsed, key: "<top-level array>" };
  }
  if (!isPlainObject2(parsed)) {
    return { ok: false, error: `payload is ${parsed === null ? "null" : typeof parsed}, not a list or an envelope` };
  }
  if (rowsKey) {
    const explicit = parsed[rowsKey];
    if (!Array.isArray(explicit)) {
      return {
        ok: false,
        error: `--rows-key '${rowsKey}' is ${explicit === undefined ? "absent" : `a ${typeof explicit}`}, not an array`
      };
    }
    return { ok: true, rows: explicit, key: rowsKey };
  }
  for (const candidate of ROWS_KEY_CANDIDATES) {
    if (Array.isArray(parsed[candidate])) {
      return { ok: true, rows: parsed[candidate], key: candidate };
    }
  }
  const arrayKeys = Object.keys(parsed).filter((k) => Array.isArray(parsed[k]));
  if (arrayKeys.length === 1) {
    return { ok: true, rows: parsed[arrayKeys[0]], key: arrayKeys[0] };
  }
  return {
    ok: false,
    error: arrayKeys.length === 0 ? `no array-valued key in envelope {${Object.keys(parsed).join(",")}}` : `ambiguous rows key: ${arrayKeys.join(", ")} \u2014 pass --rows-key`
  };
}
function readDottedPath(parsed, path) {
  let cursor = parsed;
  for (const segment of path.split(".")) {
    if (!isPlainObject2(cursor))
      return;
    cursor = cursor[segment];
  }
  return typeof cursor === "number" ? cursor : undefined;
}
function classifyRead(captured, options = {}) {
  const evidence = [];
  const refuse = (code, reason) => ({
    ok: false,
    code,
    reason,
    proofs: [],
    rows: [],
    rowCount: 0,
    evidence
  });
  evidence.push(`exit=${captured.code}`);
  evidence.push(`stdout=${captured.stdout.length}B stderr=${captured.stderr.length}B`);
  if (captured.code !== 0) {
    return refuse("nonzero_exit", `the command exited ${captured.code}. A failed read is not an empty set. ` + `Captured stderr was ${captured.stderr.length} byte(s); content was not rendered.`);
  }
  if (captured.stdout.trim() === "") {
    return refuse("unparseable_stdout", "stdout was empty; there is no payload to judge");
  }
  let parsed;
  try {
    parsed = JSON.parse(captured.stdout);
  } catch {
    return refuse("unparseable_stdout", "stdout was not valid JSON; parse details were not rendered. A parse failure is a refusal, never an empty list.");
  }
  if (isPlainObject2(parsed)) {
    if (parsed.ok === false) {
      return refuse("error_object", "the surface returned an error object at exit 0; payload content was not rendered");
    }
    if (typeof parsed.error === "string" && parsed.error.length > 0) {
      return refuse("error_object", "the surface returned an error object at exit 0; payload content was not rendered");
    }
    if (parsed.store_exists === false) {
      return refuse("store_unavailable", "the surface reported store_exists=false; zero rows here means the store was unreachable, not empty");
    }
  }
  const located = locateRows(parsed, options.rowsKey);
  if (!located.ok) {
    return refuse("rows_key_missing", `${located.error}. Refusing rather than reporting zero rows: a reader that cannot find the rows has measured nothing.`);
  }
  const rows = located.rows;
  const rowCount = rows.length;
  evidence.push(`rows=${rowCount} under ${located.key}`);
  for (const { re, note } of STDERR_TRUNCATION_PATTERNS) {
    const hit = re.exec(captured.stderr);
    if (hit) {
      return refuse("stderr_truncation_notice", `stderr carries a truncation notice (${note}); content was not rendered. ` + "The body parsed cleanly at exit 0; only stderr says the read was bounded.");
    }
  }
  let declaredTotal;
  let hasMore;
  let nextCursor;
  if (isPlainObject2(parsed)) {
    const totalKeys = options.totalKey ? [options.totalKey] : TOTAL_KEY_CANDIDATES;
    for (const key of totalKeys) {
      if (!Object.prototype.hasOwnProperty.call(parsed, key))
        continue;
      const value = parsed[key];
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        return {
          ...refuse("declared_total_mismatch", `declared ${key} must be a non-negative safe integer, got ${JSON.stringify(value)}`),
          rowCount
        };
      }
      declaredTotal = value;
      evidence.push(`declared ${key}=${value}`);
      break;
    }
    if (typeof parsed.has_more === "boolean")
      hasMore = parsed.has_more;
    else if (typeof parsed.hasMore === "boolean")
      hasMore = parsed.hasMore;
    const cursor = Object.prototype.hasOwnProperty.call(parsed, "next_cursor") ? parsed.next_cursor : parsed.nextCursor;
    if (isUsableCursor(cursor) || cursor === null)
      nextCursor = cursor;
  }
  const usableCursor = isUsableCursor(nextCursor);
  if (hasMore === true || usableCursor) {
    return {
      ...refuse("unfollowed_cursor", `the surface indicates another page (has_more=${String(hasMore)}, cursor ${usableCursor ? nextCursor : "unset"}). ` + `You are holding a page and about to call it a population.`),
      rowCount,
      declaredTotal,
      nextCursor,
      hasMore
    };
  }
  if (declaredTotal !== undefined && rowCount !== declaredTotal) {
    return {
      ...refuse("declared_total_mismatch", `holding ${rowCount} row(s) against a declared total of ${declaredTotal}. ` + `The surface's count and payload disagree, so completeness is not established.`),
      rowCount,
      declaredTotal,
      nextCursor,
      hasMore
    };
  }
  const proofs = [];
  if (declaredTotal !== undefined && rowCount === declaredTotal) {
    proofs.push("declared_total_satisfied");
    evidence.push(`rowCount ${rowCount} equals declared total ${declaredTotal}`);
  }
  if (hasMore === false || nextCursor === null) {
    proofs.push("cursor_exhausted");
    evidence.push(`surface declared no next page (has_more=${hasMore}, next_cursor=${String(nextCursor)})`);
  }
  if (proofs.length === 0) {
    const cap = options.limit !== undefined && rowCount === options.limit ? ` rowCount equals the requested limit ${options.limit}, which is what a silent cap looks like.` : "";
    return {
      ok: false,
      code: rowCount === options.limit ? "page_cap_reached" : "completeness_unproven",
      reason: `the payload carries no total, no cursor and no truncation notice, so nothing in it proves the read is whole.${cap} ` + `Establish completeness by widening the bound, or by a sibling aggregate.`,
      proofs: [],
      rows: [],
      rowCount,
      declaredTotal,
      nextCursor,
      hasMore,
      evidence
    };
  }
  if (rowCount === 0 && !options.allowEmpty) {
    evidence.push("empty result accepted only because a proof of completeness was present");
  }
  return { ok: true, proofs, reason: `read proven complete by ${proofs.join(" + ")}`, rows, rowCount, declaredTotal, nextCursor, hasMore, evidence };
}

// src/safe-read-exec.ts
var DEFAULT_MAX_PAGES = 200;
var KNOWN_CLAMPS = {
  "conversations read": { cap: 500, grade: "M", note: "requests above 500 silently return 500" },
  "conversations channel read": { cap: 500, grade: "M", note: "same path as read; the clamp is hidden above 500" },
  "conversations search": { cap: 500, grade: "M", note: "server max 500 plus a 48 KiB compact-JSON budget" },
  "conversations since": { cap: 500, grade: "S/U", note: "requests above 500 can hide the clamp" },
  "conversations pinned": { cap: 500, grade: "S/U", note: "bare JSON carries no truncation metadata" },
  "conversations notifications": { cap: 500, grade: "S/U", note: "neither surface signals the server clamp" },
  "conversations agents list": {
    cap: 500,
    grade: "M",
    note: "server hard-caps 500 newest by last_seen_at and IGNORES the client limit entirely"
  },
  "conversations blockers": { cap: 500, grade: "S/U", note: "JSON ignores --limit; the flag moves only the human surface" },
  "conversations project list": { cap: 1000, grade: "M", note: "exactly 1000 cannot prove more; the probe is itself clamped" },
  "knowledge list": { cap: 200, grade: "M", note: "--limit above 200 is REJECTED at rc=1 rather than clamped" }
};
var SUSPICIOUS_COUNTS = new Set([10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]);
var SCOPE_WIDENERS = {
  "knowledge list": { flag: "--include-archived", grade: "M", note: "default hides archived items (1526 vs 1567)" },
  "todos list": { flag: "--all", grade: "M", note: "default is a subset; --all never reveals its own population" }
};
function lookupScopeWidener(argv) {
  const words = argv.filter((token) => !token.startsWith("-"));
  for (let take = Math.min(words.length, 4);take >= 1; take -= 1) {
    const key = words.slice(0, take).join(" ");
    const hit = SCOPE_WIDENERS[key];
    if (hit)
      return { key, ...hit };
  }
  return null;
}
function lookupClamp(argv) {
  const words = argv.filter((token) => !token.startsWith("-"));
  for (let take = Math.min(words.length, 4);take >= 1; take -= 1) {
    const key = words.slice(0, take).join(" ");
    const hit = KNOWN_CLAMPS[key];
    if (hit)
      return { key, ...hit };
  }
  return null;
}
function runCaptured(argv) {
  const [bin, ...args] = argv;
  if (!bin)
    throw new Error("empty argv");
  const dir = mkdtempSync2(join8(tmpdir2(), "hasna-safe-read-"));
  const outPath = join8(dir, "stdout.bin");
  const errPath = join8(dir, "stderr.bin");
  let outFd;
  let errFd;
  try {
    outFd = openSync(outPath, "w");
    errFd = openSync(errPath, "w");
    const proc = spawnSync(bin, args, { shell: false, stdio: ["ignore", outFd, errFd] });
    closeSync(outFd);
    outFd = undefined;
    closeSync(errFd);
    errFd = undefined;
    if (proc.error) {
      const err = proc.error;
      return { stdout: "", stderr: `spawn failed: ${err.message}`, code: 252 };
    }
    return {
      stdout: readFileSync7(outPath, "utf8"),
      stderr: readFileSync7(errPath, "utf8"),
      code: proc.status ?? 253
    };
  } finally {
    if (outFd !== undefined)
      closeSync(outFd);
    if (errFd !== undefined)
      closeSync(errFd);
    rmSync3(dir, { recursive: true, force: true });
  }
}
function withFlag(argv, flag, value) {
  if (!flag)
    return argv;
  const out = [...argv];
  const at = out.indexOf(flag);
  if (at >= 0 && at + 1 < out.length) {
    out[at + 1] = String(value);
    return out;
  }
  out.push(flag, String(value));
  return out;
}
function safeRead(request) {
  const widener = lookupScopeWidener(request.argv);
  const scopeLabel = widener && request.argv.includes(widener.flag) ? widener.flag : request.scopeAck ? `default (acknowledged: ${request.scopeAck})` : "default";
  const result = safeReadInner(request);
  return {
    ...result,
    scope: result.scope && result.scope !== "default" ? result.scope : scopeLabel,
    reason: result.ok ? `${result.reason} [scope: ${scopeLabel}]` : result.reason
  };
}
function safeReadInner(request) {
  const run = request.run ?? runCaptured;
  const evidence = [];
  const maxPages = request.maxPages ?? DEFAULT_MAX_PAGES;
  evidence.push(`argv: ${request.argv.join(" ")}`);
  const widener = lookupScopeWidener(request.argv);
  const scope = widener && request.argv.includes(widener.flag) ? widener.flag : "default";
  if (widener && scope === "default" && !request.scopeAck) {
    return {
      ...fail("scope_defaulted", `${widener.key} defaults to a NARROWER SCOPE than its full population (${widener.note}, evidence ${widener.grade}). ` + `The read may be complete, the predicate correct and the declared total honest, and the number still be a subset \u2014 ` + `a declared total is scope-relative, so reconciling against it CONFIRMS this rather than catching it. ` + `Pass ${widener.flag} for the wider scope, or --scope-ack to record the narrower one as a deliberate choice.`, evidence, 0),
      scope
    };
  }
  if (widener)
    evidence.push(`scope: ${scope} (widener ${widener.flag} available, grade ${widener.grade})`);
  else
    evidence.push(`scope: ${request.scopeAck ?? "unqualified"} (no scope widener in census for this surface)`);
  if (request.probeNegativeArgs?.length || request.probePositiveArgs?.length) {
    const probe = probePredicate(request, run, evidence);
    if (probe)
      return probe;
  }
  let argv = request.argv;
  if (request.limit !== undefined)
    argv = withFlag(argv, request.limitFlag ?? "--limit", request.limit);
  if (argv.join(" ") !== request.argv.join(" "))
    evidence.push(`ran: ${argv.join(" ")}`);
  let captured = run(argv);
  let verdict = classifyRead(captured, {
    rowsKey: request.rowsKey,
    totalKey: request.totalKey,
    allowEmpty: request.allowEmpty,
    limit: request.limit
  });
  evidence.push(...verdict.evidence);
  let pages = 1;
  if (!verdict.ok && verdict.code === "unfollowed_cursor" && request.cursorFlag) {
    const accumulated = [];
    let cursor = verdict.nextCursor;
    let declaredTotal = verdict.declaredTotal;
    let declaredTotalShape;
    if (!isUsableCursor(cursor)) {
      return fail("unfollowed_cursor", "the surface indicates another page but supplied no usable cursor; refusing rather than treating the first page as exhausted", evidence, pages);
    }
    const first = locateRows(safeParse3(captured.stdout), request.rowsKey);
    if (first.ok)
      accumulated.push(...first.rows);
    while (isUsableCursor(cursor) && pages < maxPages) {
      const paged = withFlag(argv, request.cursorFlag, cursor);
      captured = run(paged);
      pages += 1;
      verdict = classifyRead(captured, {
        rowsKey: request.rowsKey,
        totalKey: request.totalKey,
        allowEmpty: true,
        limit: request.limit
      });
      if (verdict.declaredTotal !== undefined) {
        if (declaredTotal === undefined) {
          return fail("declared_total_mismatch", `paging introduced a declared total of ${verdict.declaredTotal} after page 1; ` + `its population-relative semantics cannot be established from the later page alone`, evidence, pages);
        }
        const samePopulation = verdict.declaredTotal === declaredTotal;
        const remainingPopulation = accumulated.length + verdict.declaredTotal === declaredTotal;
        if (!samePopulation && !remainingPopulation) {
          return fail("declared_total_mismatch", `paging changed its declared total from ${declaredTotal} to ${verdict.declaredTotal} ` + `after ${accumulated.length} accumulated row(s); it matches neither a stable population total ` + `nor a cursor-relative remaining total`, evidence, pages);
        }
        const observedShape = samePopulation ? "population" : "remaining";
        if (declaredTotalShape !== undefined && declaredTotalShape !== observedShape) {
          return fail("declared_total_mismatch", `paging changed declared-total semantics from ${declaredTotalShape} to ${observedShape}`, evidence, pages);
        }
        declaredTotalShape = observedShape;
        evidence.push(`page ${pages} declared total ${verdict.declaredTotal} as a ${observedShape} count ` + `after ${accumulated.length} accumulated row(s)`);
      }
      const located = locateRows(safeParse3(captured.stdout), request.rowsKey);
      if (located.ok)
        accumulated.push(...located.rows);
      if (verdict.ok || verdict.code === "declared_total_mismatch" && (verdict.hasMore === false || verdict.nextCursor === null)) {
        cursor = null;
        break;
      }
      if (verdict.code !== "unfollowed_cursor") {
        return fail(verdict.code, `paging stopped at page ${pages}: ${verdict.reason}`, evidence, pages);
      }
      cursor = verdict.nextCursor;
      if (!isUsableCursor(cursor)) {
        return fail("unfollowed_cursor", `paging stopped at page ${pages}: the surface indicates another page but supplied no usable cursor`, evidence, pages);
      }
    }
    if (isUsableCursor(cursor) && pages >= maxPages) {
      return fail("unfollowed_cursor", `still paging after ${maxPages} pages; refusing rather than reporting a partial set`, evidence, pages);
    }
    if (declaredTotal !== undefined && accumulated.length !== declaredTotal) {
      return fail("declared_total_mismatch", `paged to exhaustion with ${accumulated.length} row(s) against a declared total of ${declaredTotal}`, evidence, pages);
    }
    if (declaredTotal !== undefined) {
      evidence.push(`accumulated rowCount ${accumulated.length} equals declared total ${declaredTotal}`);
    }
    evidence.push(`paged to exhaustion over ${pages} page(s), ${accumulated.length} row(s)`);
    return {
      ok: true,
      reason: `read proven complete by cursor_exhausted over ${pages} page(s)`,
      proofs: ["cursor_exhausted"],
      rows: accumulated,
      rowCount: accumulated.length,
      pages,
      scope: "default",
      evidence
    };
  }
  if (verdict.ok) {
    return { ok: true, reason: verdict.reason, proofs: verdict.proofs, rows: verdict.rows, rowCount: verdict.rowCount, pages, scope: "default", evidence };
  }
  const recoverable = ["completeness_unproven", "page_cap_reached", "declared_total_mismatch", "stderr_truncation_notice"];
  if (!recoverable.includes(verdict.code)) {
    return fail(verdict.code, verdict.reason, evidence, pages);
  }
  if (request.siblingArgv?.length && request.siblingPath) {
    const sib = run(request.siblingArgv);
    if (sib.code !== 0) {
      evidence.push(`sibling aggregate unavailable (exit ${sib.code}); falling through`);
    } else {
      const aggregate = readDottedPath(safeParse3(sib.stdout), request.siblingPath);
      if (aggregate === undefined) {
        evidence.push(`sibling path '${request.siblingPath}' absent or non-numeric; falling through`);
      } else {
        evidence.push(`sibling ${request.siblingPath}=${aggregate} vs rows=${verdict.rowCount}`);
        if (aggregate === verdict.rowCount) {
          const rows = locateRows(safeParse3(captured.stdout), request.rowsKey);
          return {
            ok: true,
            reason: `read proven complete by sibling_aggregate_agrees (${request.siblingPath}=${aggregate})`,
            proofs: ["sibling_aggregate_agrees"],
            rows: rows.ok ? rows.rows : [],
            rowCount: verdict.rowCount,
            pages,
            scope: "default",
            evidence
          };
        }
        return fail("declared_total_mismatch", `sibling aggregate ${request.siblingPath}=${aggregate} disagrees with ${verdict.rowCount} row(s) read`, evidence, pages);
      }
    }
  }
  if (request.limitFlag !== undefined || request.limit !== undefined) {
    const flag = request.limitFlag ?? "--limit";
    const base = request.limit ?? verdict.rowCount;
    const wider = request.widenTo ?? Math.max(base * 4, base + 1);
    const widened = run(withFlag(request.argv, flag, wider));
    pages += 1;
    if (widened.code !== 0) {
      return fail("completeness_unproven", `widening probe to ${flag} ${wider} exited ${widened.code}, so completeness is still unproven. ` + `Captured stderr was ${widened.stderr.length} byte(s); content was not rendered.`, evidence, pages);
    }
    const wideVerdict = classifyRead(widened, {
      rowsKey: request.rowsKey,
      totalKey: request.totalKey,
      allowEmpty: true,
      limit: wider
    });
    const wideRows = locateRows(safeParse3(widened.stdout), request.rowsKey);
    const wideCount = wideRows.ok ? wideRows.rows.length : -1;
    evidence.push(`widened ${flag} ${base} -> ${wider}: ${verdict.rowCount} -> ${wideCount} row(s)`);
    evidence.push(...wideVerdict.evidence.map((line) => `widened: ${line}`));
    if (wideVerdict.ok) {
      return { ok: true, reason: `widened read proven complete by ${wideVerdict.proofs.join(" + ")}`, proofs: wideVerdict.proofs, rows: wideVerdict.rows, rowCount: wideVerdict.rowCount, pages, scope: "default", evidence };
    }
    if (wideVerdict.code !== "completeness_unproven" && wideVerdict.code !== "page_cap_reached") {
      return fail(wideVerdict.code, `widening probe failed: ${wideVerdict.reason}`, evidence, pages);
    }
    if (wideCount >= 0 && wideCount < wider) {
      const clamp = request.knownClamp ?? lookupClamp(request.argv)?.cap;
      const clampNote = lookupClamp(request.argv);
      if (clamp !== undefined && wideCount >= clamp) {
        return fail("hidden_clamp_suspected", `widening to ${wider} returned ${wideCount} row(s), which meets this surface's known server cap of ${clamp}` + (clampNote ? ` (${clampNote.key}, evidence ${clampNote.grade}: ${clampNote.note})` : "") + `. The bound you asked for was never honoured, so a count below it proves nothing. ` + `Page with a cursor, or cross-check against a sibling aggregate.`, evidence, pages);
      }
      if (clamp === undefined && SUSPICIOUS_COUNTS.has(wideCount)) {
        return fail("hidden_clamp_suspected", `widening to ${wider} returned exactly ${wideCount} row(s) \u2014 a round number, and this surface is not in the ` + `clamp census, so a silent server cap cannot be ruled out. Widening cannot tell a population of ${wideCount} ` + `from a hidden cap at ${wideCount}. Supply --known-clamp once you have established the real cap, or prove ` + `completeness with a cursor or a sibling aggregate.`, evidence, pages);
      }
      if (wideCount > verdict.rowCount) {
        evidence.push(`population grew between reads (${verdict.rowCount} -> ${wideCount}); returning the wider read`);
      }
      if (clampNote)
        evidence.push(`clamp census: ${clampNote.key} cap=${clampNote.cap} grade=${clampNote.grade}`);
      return {
        ok: true,
        reason: `read proven complete by stable_under_widening (${wideCount} row(s), strictly below the bound ${wider}${clamp !== undefined ? ` and below the known cap ${clamp}` : " and not a round number"})`,
        proofs: ["stable_under_widening"],
        rows: wideRows.ok ? wideRows.rows : [],
        rowCount: wideCount,
        pages,
        scope: "default",
        evidence
      };
    }
    return fail("page_cap_reached", `widening to ${wider} returned ${wideCount} row(s), which still equals the bound. The population is at least ${wideCount} and the read is still a page.`, evidence, pages);
  }
  if (request.assumeComplete) {
    const rows = locateRows(safeParse3(captured.stdout), request.rowsKey);
    evidence.push("CALLER WAIVED PROOF (--assume-complete): this result is asserted, not established");
    return {
      ok: true,
      reason: "completeness ASSUMED by the caller, not proven",
      proofs: ["assumed_complete"],
      rows: rows.ok ? rows.rows : [],
      rowCount: verdict.rowCount,
      pages,
      scope: "default",
      evidence
    };
  }
  return fail(verdict.code, verdict.reason, evidence, pages);
}
function probePredicate(request, run, evidence) {
  const count = (argv) => {
    const cap = run(argv);
    if (cap.code !== 0)
      return null;
    const located = locateRows(safeParse3(cap.stdout), request.rowsKey);
    return located.ok ? located.rows.length : null;
  };
  if (request.probePositiveArgs?.length) {
    const positive = count([...request.argv, ...request.probePositiveArgs]);
    evidence.push(`predicate probe positive -> ${positive === null ? "unreadable" : positive} row(s)`);
    if (positive === null || positive === 0) {
      return fail("predicate_inert", `a predicate known to match returned ${positive === null ? "an unreadable result" : "zero rows"}. ` + `The query surface is not matching what it should, so a zero from the real query would mean nothing.`, evidence, 0);
    }
  }
  if (request.probeNegativeArgs?.length) {
    const negative = count([...request.argv, ...request.probeNegativeArgs]);
    evidence.push(`predicate probe negative -> ${negative === null ? "unreadable" : negative} row(s)`);
    if (negative === null) {
      return fail("predicate_ignored", "the negative predicate probe produced an unreadable result", evidence, 0);
    }
    if (negative > 0) {
      return fail("predicate_ignored", `a predicate known to match NOTHING returned ${negative} row(s). The surface is ignoring the predicate, ` + `so these rows are not the set you asked for. Use an exact-identity lookup instead of this query verb.`, evidence, 0);
    }
  }
  return null;
}
function safeParse3(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
function fail(code, reason, evidence, pages) {
  return { ok: false, code, reason, proofs: [], rows: [], rowCount: 0, pages, scope: "default", evidence };
}

// src/cli/read.ts
function toInt(value, flag) {
  if (value === undefined)
    return;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${flag} must be a positive integer, got '${value}'`);
  }
  return n;
}
function runSafeReadCli(argv, options, io = {
  log: (s) => console.log(s),
  err: (s) => console.error(s)
}) {
  if (argv.length === 0) {
    io.err("contracts read: no command given. Usage: contracts read [options] -- <command> [args...]");
    return 3;
  }
  let result;
  try {
    result = safeRead({
      argv,
      rowsKey: options.rowsKey,
      totalKey: options.totalKey,
      allowEmpty: options.allowEmpty,
      limitFlag: options.limitFlag,
      limit: toInt(options.limit, "--limit"),
      widenTo: toInt(options.widenTo, "--widen-to"),
      knownClamp: toInt(options.knownClamp, "--known-clamp"),
      cursorFlag: options.cursorFlag,
      maxPages: toInt(options.maxPages, "--max-pages"),
      siblingArgv: options.siblingArg,
      siblingPath: options.siblingPath,
      probeNegativeArgs: options.probeNegativeArg,
      probePositiveArgs: options.probePositiveArg,
      assumeComplete: options.assumeComplete,
      scopeAck: options.scopeAck
    });
  } catch (error2) {
    io.err(`contracts read: ${error2 instanceof Error ? error2.message : String(error2)}`);
    return 3;
  }
  if (options.json) {
    io.log(JSON.stringify(result.ok ? { ok: true, proofs: result.proofs, rowCount: result.rowCount, pages: result.pages, scope: result.scope, rows: result.rows, evidence: result.evidence } : { ok: false, code: result.code, error: result.reason, pages: result.pages, scope: result.scope, evidence: result.evidence }, null, 2));
    return result.ok ? 0 : 2;
  }
  if (result.ok) {
    io.err(`contracts read: PASS \u2014 ${result.reason}`);
    for (const line of result.evidence)
      io.err(`  ${line}`);
    io.log(JSON.stringify(result.rows, null, 2));
    return 0;
  }
  io.err(`contracts read: REFUSED [${result.code}]`);
  io.err(`  ${result.reason}`);
  for (const line of result.evidence)
    io.err(`  ${line}`);
  io.err("  No rows are printed. A refused read is not an empty set.");
  return 2;
}

// src/cli/verify-write.ts
import { readFileSync as readFileSync8 } from "fs";

// src/verify-write.ts
import { createHash as createHash6 } from "crypto";
function readPath(value, path) {
  let current = value;
  for (const segment of path.split(".")) {
    if (!segment || current === null || typeof current !== "object") {
      return { found: false };
    }
    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      return { found: false };
    }
    current = current[segment];
  }
  return { found: true, value: current };
}
function sha2562(value) {
  return createHash6("sha256").update(value).digest("hex");
}
function refused(code, message) {
  return { ok: false, status: "refused", code, message };
}
function verifyFetchedWrite(request) {
  const idRead = readPath(request.fetched, request.idPath ?? "id");
  if (!idRead.found) {
    return refused("object_id_missing", "fetched object ID was missing; stored body NOT rendered");
  }
  if (typeof idRead.value !== "string") {
    return refused("object_id_invalid", "fetched object ID was not a string; stored body NOT rendered");
  }
  if (idRead.value !== request.targetId) {
    return refused("object_id_mismatch", "fetched object ID did not equal requested ID; stored body NOT rendered");
  }
  const contentRead = readPath(request.fetched, request.contentPath ?? "body");
  if (!contentRead.found) {
    return refused("content_missing", "stored content field was missing; stored body NOT rendered");
  }
  if (typeof contentRead.value !== "string") {
    return refused("content_invalid", "stored content field was not a string; stored body NOT rendered");
  }
  const authored = Buffer.from(request.authored);
  const stored = Buffer.from(contentRead.value, "utf8");
  const authoredBytes = authored.byteLength;
  const storedBytes = stored.byteLength;
  const deltaBytes = storedBytes - authoredBytes;
  const hashesEqual = sha2562(authored) === sha2562(stored);
  if (hashesEqual) {
    return {
      ok: true,
      status: "match",
      authoredBytes,
      storedBytes,
      deltaBytes: 0,
      hashesEqual: true,
      message: `fetched object ID equals requested ID; ${authoredBytes} bytes; SHA-256 equal; stored body NOT rendered`
    };
  }
  if (deltaBytes > 0) {
    return {
      ok: false,
      status: "grew",
      authoredBytes,
      storedBytes,
      deltaBytes,
      hashesEqual: false,
      message: `third-party content appended, ${deltaBytes} bytes, NOT rendered`
    };
  }
  if (deltaBytes < 0) {
    return {
      ok: false,
      status: "shrunk",
      authoredBytes,
      storedBytes,
      deltaBytes,
      hashesEqual: false,
      message: "stored content is shorter, NOT rendered"
    };
  }
  return {
    ok: false,
    status: "mismatch",
    authoredBytes,
    storedBytes,
    deltaBytes: 0,
    hashesEqual: false,
    message: "byte length equal but SHA-256 differs; stored body NOT rendered"
  };
}

// src/cli/verify-write.ts
var defaultIo = {
  log: (line) => console.log(line),
  err: (line) => console.error(line)
};
function refusal(code, message) {
  return { ok: false, status: "refused", code, message };
}
function writeResult(result, json, io) {
  if (json) {
    io.log(JSON.stringify(result));
  } else if (result.status === "match") {
    io.log(`MATCH \u2014 ${result.message}`);
  } else if (result.status === "refused") {
    io.err(`REFUSED [${result.code}] \u2014 ${result.message}`);
  } else if (result.status === "grew") {
    io.err(`GREW BY ${result.deltaBytes} BYTES \u2014 ${result.message}`);
  } else if (result.status === "shrunk") {
    io.err(`SHRANK BY ${Math.abs(result.deltaBytes)} BYTES \u2014 ${result.message}`);
  } else {
    io.err(`MISMATCH \u2014 ${result.message}`);
  }
  if (result.status === "match")
    return 0;
  if (result.status === "refused")
    return 2;
  return 1;
}
function runVerifyWriteCli(targetId, argv, options, io = defaultIo, run = runCaptured) {
  if (!targetId || !options.authored || argv.length === 0) {
    writeResult(refusal("usage", "target, --authored, and a fetch command after -- are required; stored body NOT rendered"), Boolean(options.json), io);
    return 3;
  }
  let authored;
  try {
    authored = readFileSync8(options.authored);
  } catch {
    return writeResult(refusal("authored_read_failed", "authored payload could not be read; stored body NOT rendered"), Boolean(options.json), io);
  }
  let captured;
  try {
    captured = run(argv);
  } catch {
    return writeResult(refusal("fetch_failed", "fetch command could not be executed; captured output NOT rendered"), Boolean(options.json), io);
  }
  if (captured.code !== 0) {
    return writeResult(refusal("fetch_failed", "fetch command did not succeed; captured output NOT rendered"), Boolean(options.json), io);
  }
  let fetched;
  try {
    fetched = JSON.parse(captured.stdout);
  } catch {
    return writeResult(refusal("fetch_invalid_json", "fetch command did not return one JSON object; captured output NOT rendered"), Boolean(options.json), io);
  }
  const result = verifyFetchedWrite({
    targetId,
    authored,
    fetched,
    idPath: options.idPath ?? "id",
    contentPath: options.contentPath ?? "body"
  });
  return writeResult(result, Boolean(options.json), io);
}

// src/cli/index.ts
function collectJsonFiles(root) {
  const stat = statSync5(root);
  if (stat.isFile()) {
    return root.endsWith(".json") ? [root] : [];
  }
  const files = [];
  for (const entry of readdirSync5(root).sort()) {
    files.push(...collectJsonFiles(join9(root, entry)));
  }
  return files;
}
function readJsonFile(file) {
  try {
    return { ok: true, value: JSON.parse(readFileSync9(file, "utf8")) };
  } catch (error2) {
    const message = error2 instanceof Error ? error2.message : String(error2);
    return { ok: false, error: message };
  }
}
function reportCliError(options, error2, details = {}) {
  if (options.json) {
    console.log(JSON.stringify({ ok: false, error: error2, ...details }, null, 2));
  } else {
    console.error(error2);
  }
  process.exitCode = 2;
}
function argvRequestsJson(argv) {
  return argv.includes("--json") || argv.includes("-j");
}
function reportParserJsonError(code, error2) {
  console.log(JSON.stringify({ ok: false, code, error: error2 }, null, 2));
  process.exitCode = 1;
  return true;
}
function preflightJsonUsageErrors(argv) {
  if (!argvRequestsJson(argv)) {
    return false;
  }
  const args = argv.slice(2);
  const command = args[0];
  if (!command) {
    return false;
  }
  if (!["schemas", "validate", "conformance", "no-cloud-scan", "repo-conformance", "vendor-kit", "issue-key", "artifact-scan", "secure-local-store", "read", "verify-write"].includes(command)) {
    return reportParserJsonError("commander.unknownCommand", `unknown command '${command}'`);
  }
  if (command === "issue-key") {
    return false;
  }
  if (command === "read" || command === "verify-write") {
    return false;
  }
  const allowedOptionsByCommand = {
    schemas: new Set(["--json", "-j"]),
    validate: new Set(["--json", "-j", "--schema"]),
    conformance: new Set(["--json", "-j"]),
    "no-cloud-scan": new Set(["--json", "-j", "--manifest"]),
    "repo-conformance": new Set(["--json", "-j"]),
    "vendor-kit": new Set(["--json", "-j", "--check", "--kit-version", "--no-contract"]),
    "artifact-scan": new Set([
      "--json",
      "-j",
      "--manifest",
      "--domain-threshold",
      "--host-threshold",
      "--ip-threshold",
      "--email-threshold"
    ]),
    "secure-local-store": new Set(["--json", "-j", "--store"])
  };
  const allowedOptions = allowedOptionsByCommand[command] ?? new Set;
  const positionals = [];
  for (let index = 1;index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }
    if (arg.startsWith("--schema=")) {
      if (arg.slice("--schema=".length).length === 0) {
        return reportParserJsonError("commander.optionMissingArgument", "option '--schema <id>' argument missing");
      }
      continue;
    }
    if (arg === "--schema") {
      const schemaValue = args[index + 1];
      if (!schemaValue || schemaValue.startsWith("-")) {
        return reportParserJsonError("commander.optionMissingArgument", "option '--schema <id>' argument missing");
      }
      index += 1;
      continue;
    }
    if (arg.startsWith("--manifest=")) {
      if (arg.slice("--manifest=".length).length === 0) {
        return reportParserJsonError("commander.optionMissingArgument", "option '--manifest <file>' argument missing");
      }
      continue;
    }
    if (arg === "--manifest") {
      const manifestValue = args[index + 1];
      if (!manifestValue || manifestValue.startsWith("-")) {
        return reportParserJsonError("commander.optionMissingArgument", "option '--manifest <file>' argument missing");
      }
      index += 1;
      continue;
    }
    if (arg.startsWith("--store=")) {
      if (arg.slice("--store=".length).length === 0) {
        return reportParserJsonError("commander.optionMissingArgument", "option '--store <id>' argument missing");
      }
      continue;
    }
    if (arg === "--store") {
      const storeValue = args[index + 1];
      if (!storeValue || storeValue.startsWith("-")) {
        return reportParserJsonError("commander.optionMissingArgument", "option '--store <id>' argument missing");
      }
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      if (!allowedOptions.has(arg)) {
        return reportParserJsonError("commander.unknownOption", `unknown option '${arg}'`);
      }
      continue;
    }
    positionals.push(arg);
  }
  if (command === "validate" && positionals.length === 0) {
    return reportParserJsonError("commander.missingArgument", "missing required argument 'file'");
  }
  return false;
}
function collectOption(value, previous = []) {
  return [...previous, value];
}
function printSecureLocalStoreText(payload) {
  console.log(`ok ${payload.schema} ${payload.id}`);
  for (const store of payload.stores) {
    console.log(`  ${store.storeId} ${store.packageName} ${store.root}/${store.relativePath}`);
  }
}
function createContractsProgram() {
  const program2 = new Command;
  program2.name("contracts").description("Validate Hasna shared contract JSON files").version(CONTRACTS_PACKAGE_VERSION);
  program2.command("schemas").description("List known contract schema ids").option("-j, --json", "Output JSON").action((options) => {
    const schemas3 = Object.keys(ContractSchemaRegistry);
    if (options.json) {
      console.log(JSON.stringify({ version: CONTRACTS_PACKAGE_VERSION, schemas: schemas3 }, null, 2));
      return;
    }
    for (const schema of schemas3) {
      console.log(schema);
    }
  });
  program2.command("validate").description("Validate a JSON file against a contract schema").argument("<file>", "JSON file path").option("--schema <id>", "Contract schema id. Defaults to the file's embedded schema field").option("-j, --json", "Output JSON").action((file, options) => {
    const loaded = readJsonFile(file);
    if (!loaded.ok) {
      reportCliError(options, `Could not read or parse ${file}: ${loaded.error}`, { file, code: "read_or_parse_error" });
      return;
    }
    const schemaId = options.schema ? options.schema : getEmbeddedSchemaId(loaded.value);
    if (!schemaId || !(schemaId in ContractSchemaRegistry)) {
      const error2 = options.schema ? `Unknown schema: ${options.schema}` : "No schema provided and file does not include a known embedded schema field";
      reportCliError(options, error2, { file, schema: options.schema ?? null, code: "unknown_schema" });
      return;
    }
    const result = validateContract(schemaId, loaded.value);
    if (result.success) {
      if (options.json) {
        console.log(JSON.stringify({ ok: true, schema: schemaId, file }, null, 2));
      } else {
        console.log(`ok ${schemaId} ${file}`);
      }
      return;
    }
    if (options.json) {
      console.log(JSON.stringify({ ok: false, schema: schemaId, file, issues: result.error.issues }, null, 2));
    } else {
      console.error(`invalid ${schemaId} ${file}`);
      for (const issue2 of result.error.issues) {
        console.error(`- ${issue2.path.join(".") || "<root>"}: ${issue2.message}`);
      }
    }
    process.exitCode = 1;
  });
  program2.command("conformance").description("Validate example fixtures. *.valid.json must pass; *.invalid.json must fail").argument("[path]", "Examples path", "examples").option("-j, --json", "Output JSON").action((root, options) => {
    let files;
    try {
      files = collectJsonFiles(root).filter((file) => file.endsWith(".valid.json") || file.endsWith(".invalid.json"));
    } catch (error2) {
      const message = error2 instanceof Error ? error2.message : String(error2);
      reportCliError(options, `Could not read examples path ${root}: ${message}`, { path: root, code: "examples_path_error" });
      return;
    }
    if (files.length === 0) {
      reportCliError(options, `No conformance fixtures found in ${root}`, { path: root, checked: 0, code: "no_fixtures" });
      return;
    }
    const results = files.map((file) => {
      const expectedValid = file.endsWith(".valid.json");
      const loaded = readJsonFile(file);
      if (!loaded.ok) {
        return { file, expectedValid, ok: false, schema: null, error: loaded.error };
      }
      const schemaId = getEmbeddedSchemaId(loaded.value);
      if (!schemaId) {
        return { file, expectedValid, ok: false, schema: null, error: "missing or unknown embedded schema" };
      }
      const result = validateContract(schemaId, loaded.value);
      const valid = result.success;
      return {
        file,
        expectedValid,
        ok: expectedValid ? valid : !valid,
        schema: schemaId,
        error: result.success ? null : result.error.issues.map((issue2) => `${issue2.path.join(".") || "<root>"}: ${issue2.message}`).join("; ")
      };
    });
    const failed = results.filter((result) => !result.ok);
    if (options.json) {
      console.log(JSON.stringify({ ok: failed.length === 0, checked: results.length, failed: failed.length, results }, null, 2));
    } else {
      for (const result of results) {
        console.log(`${result.ok ? "ok" : "fail"} ${result.expectedValid ? "valid" : "invalid"} ${result.schema ?? "unknown"} ${result.file}`);
        if (!result.ok && result.error) {
          console.log(`  ${result.error}`);
        }
      }
    }
    if (failed.length > 0) {
      process.exitCode = 1;
    }
  });
  program2.command("no-cloud-scan").description("Scan a source tree or packed tarball for forbidden shared cloud runtime edges").argument("[path]", "Directory, .tgz, or .tar.gz path", ".").option("--manifest <file>", "Optional app cloud manifest JSON file to validate").option("-j, --json", "Output JSON evidence pack").action((target, options) => {
    let manifest;
    const manifestSupplied = Object.prototype.hasOwnProperty.call(options, "manifest") && options.manifest !== undefined;
    if (manifestSupplied) {
      if (!options.manifest) {
        reportCliError(options, "option '--manifest <file>' argument missing", {
          code: "manifest_missing_argument"
        });
        return;
      }
      const loaded = readJsonFile(options.manifest);
      if (!loaded.ok) {
        reportCliError(options, `Could not read or parse ${options.manifest}: ${loaded.error}`, {
          file: options.manifest,
          code: "manifest_read_or_parse_error"
        });
        return;
      }
      manifest = loaded.value;
    }
    let evidence;
    try {
      evidence = scanNoCloudTarget(target, manifestSupplied ? { manifest } : {});
    } catch (error2) {
      const message = error2 instanceof Error ? error2.message : String(error2);
      reportCliError(options, `No-cloud scan failed for ${target}: ${message}`, { path: target, code: "no_cloud_scan_error" });
      return;
    }
    if (options.json) {
      console.log(JSON.stringify(evidence, null, 2));
    } else {
      console.log(`${evidence.verdict === "passed" ? "ok" : "fail"} ${evidence.schema} ${target}`);
      for (const finding of evidence.findings) {
        console.log(`- ${finding.severity} ${finding.kind} ${finding.path ?? "<manifest>"}: ${finding.message}`);
      }
    }
    if (evidence.verdict !== "passed") {
      process.exitCode = 1;
    }
  });
  program2.command("secure-local-store").description("Print the execution-free .hasna/.codewith secure local-store policy").option("--store <id>", "Limit to a store id; repeat for multiple stores", collectOption, []).option("-j, --json", "Output JSON").action((options) => {
    const stores = options.store && options.store.length > 0 ? options.store : undefined;
    let policy;
    try {
      policy = secureLocalStorePolicy(stores);
    } catch (error2) {
      const message = error2 instanceof Error ? error2.message : String(error2);
      reportCliError(options, `secure-local-store failed: ${message}`, { code: "secure_local_store_error" });
      return;
    }
    if (options.json) {
      console.log(JSON.stringify(policy, null, 2));
    } else {
      printSecureLocalStoreText(policy);
    }
  });
  program2.command("repo-conformance").description("Check a repo against the Hasna Service Contract v1 using its hasna.contract.json").argument("[path]", "Repo root path", ".").option("-j, --json", "Output JSON report").action((target, options) => {
    let report;
    try {
      report = runRepoConformance(target);
    } catch (error2) {
      const message = error2 instanceof Error ? error2.message : String(error2);
      reportCliError(options, `Repo conformance failed for ${target}: ${message}`, { path: target, code: "repo_conformance_error" });
      return;
    }
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`${report.ok ? "ok" : "fail"} hasna.service_contract.v1 ${report.name ?? "?"} (${report.class ?? "?"}) ${target}`);
      for (const check2 of report.checks) {
        console.log(`  ${check2.status} ${check2.id}: ${check2.detail}`);
      }
    }
    if (!report.ok) {
      process.exitCode = 1;
    }
  });
  program2.command("vendor-kit").description("Stamp the canonical Postgres storage kit into a repo at src/generated/storage-kit/").argument("[path]", "Target repo root", ".").option("--check", "Verify the vendored kit matches the generator (CI mode); exit 1 if stale/hand-edited").option("--kit-version <version>", "Override the stamped kit version (defaults to @hasna/contracts version)").option("--no-contract", "Do not update hasna.contract.json kitVersion").option("-j, --json", "Output JSON").action((target, options) => {
    try {
      runVendorKit(target, options);
    } catch (error2) {
      const message = error2 instanceof Error ? error2.message : String(error2);
      reportCliError(options, `vendor-kit failed for ${target}: ${message}`, { path: target, code: "vendor_kit_error" });
    }
  });
  program2.command("artifact-scan").description("Scan a PACKED artifact (.tgz) for bulk asset inventories \u2014 run this from prepack, never against src/").argument("<target>", "Path to a packed .tgz/.tar.gz, or a directory for local iteration").option("--domain-threshold <n>", "Distinct registrable domains in one file that constitute an inventory").option("--host-threshold <n>", "Distinct hostnames in one file that constitute an inventory").option("--ip-threshold <n>", "Distinct public IPv4 addresses in one file that constitute an inventory").option("--email-threshold <n>", "Distinct email addresses in one file that constitute an inventory").option("--manifest <file>", "Contract manifest declaring metadata.conformance.waivedAssetInventories (default ./hasna.contract.json)").option("-j, --json", "Output JSON").action((target, options) => {
    const thresholds = {};
    for (const [flag, kind] of [
      ["domainThreshold", "domain"],
      ["hostThreshold", "host"],
      ["ipThreshold", "ip"],
      ["emailThreshold", "email"]
    ]) {
      const raw = options[flag];
      if (raw === undefined)
        continue;
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1) {
        reportCliError(options, `--${kind}-threshold must be a positive integer`, { code: "bad_threshold" });
        return;
      }
      thresholds[kind] = parsed;
    }
    const manifestSupplied = Object.prototype.hasOwnProperty.call(options, "manifest");
    if (manifestSupplied && !options.manifest) {
      reportCliError(options, "option '--manifest <file>' argument missing", {
        code: "manifest_missing_argument"
      });
      return;
    }
    const manifestPath = manifestSupplied ? String(options.manifest) : join9(process.cwd(), "hasna.contract.json");
    if (manifestSupplied && !existsSync5(manifestPath)) {
      reportCliError(options, `Could not read or parse ${manifestPath}: no such file`, {
        file: manifestPath,
        code: "manifest_read_or_parse_error"
      });
      return;
    }
    try {
      const waivers = resolveAssetInventoryWaivers(manifestPath);
      const report = scanPublishedArtifact(target, { thresholds, waivedKinds: waivers.kinds });
      if (options.json) {
        console.log(JSON.stringify({ ...report, waiverNotes: waivers.notes }, null, 2));
      } else {
        for (const note of waivers.notes)
          console.log(`waiver: ${note}`);
        console.log(formatArtifactScanReport(report));
      }
      if (!report.ok)
        process.exitCode = 1;
    } catch (error2) {
      const message = error2 instanceof Error ? error2.message : String(error2);
      reportCliError(options, `artifact-scan failed for ${target}: ${message}`, { path: target, code: "artifact_scan_error" });
    }
  });
  program2.command("read").description("Run a Hasna collection read and either prove it complete or REFUSE (exit 2)").argument("[command...]", "The command to run, after --. e.g. contracts read -- todos list --json").option("--rows-key <key>", "Key holding the row array (auto-detected when omitted)").option("--total-key <key>", "Key holding a self-declared population size").option("--limit-flag <flag>", "Flag the target uses to bound rows (default --limit)").option("--limit <n>", "Bound to pass on the first read; enables the widening proof").option("--widen-to <n>", "Bound for the widening probe (default limit * 4)").option("--known-clamp <n>", "The server cap this surface really imposes, if you have established it").option("--cursor-flag <flag>", "Flag the target uses to page, e.g. --cursor").option("--max-pages <n>", "Refuse rather than page beyond this many pages (default 200)").option("--sibling-arg <arg>", "Repeatable: argv of a sibling verb carrying an aggregate", collectOption).option("--sibling-path <path>", "Dotted path to the aggregate, e.g. by_scope.global").option("--probe-positive-arg <arg>", "Repeatable: tokens forming a query that MUST match something", collectOption).option("--probe-negative-arg <arg>", "Repeatable: tokens forming a query that MUST match nothing", collectOption).option("--allow-empty", "An empty result is a legitimate answer here").option("--assume-complete", "Waive proof; recorded in the evidence and never silent").option("--scope-ack <why>", "Record the narrower default scope as a deliberate choice, and say why").option("-j, --json", "Output JSON").action((command, options) => {
    process.exitCode = runSafeReadCli(command ?? [], options);
  });
  program2.command("verify-write").description("Cheaper than rendering a stored body: compare byte length and SHA-256; prevents appended capability content from reaching output").argument("<target>", "Exact object ID requested from the fetch command").argument("[command...]", "The fetch command to run after --; it must return one JSON object").requiredOption("--authored <file>", "File containing the exact payload the caller authored").option("--id-path <path>", "Dotted path to the fetched object's ID", "id").option("--content-path <path>", "Dotted path to the fetched stored content", "body").option("-j, --json", "Output metadata-only JSON").action((target, command, options) => {
    process.exitCode = runVerifyWriteCli(target, command ?? [], options);
  });
  program2.command("issue-key").description("Mint an API key: disclose it once, or deliver it silently to an exact Hasna Secrets reference").requiredOption("--app <app>", "App slug the key authenticates (e.g. todos)").option("--agent <agent>", "Issued-to agent/subject (informational)").option("--tid <tenant>", "Tenant/organization the key acts for (UUID, ULID, slug, or prefixed id). Omit for an untenanted key").option("--scopes <csv>", "Comma-separated scopes, e.g. 'todos:read,todos:write' or 'todos:*'").option("--ttl-days <days>", "Days until expiry (default 90)").option("--no-expiry", "Mint a non-expiring key").option("--bootstrap", "Mint a bootstrap admin key (scopes default to '<app>:*', agent 'bootstrap')").option("--signing-secret-env <name>", "Env var holding the HMAC signing secret (default HASNA_<APP>_API_SIGNING_KEY, then HASNA_API_SIGNING_KEY); the value is normalized (whitespace-trimmed) before signing, so a stored secret carrying a trailing newline signs identically to one without").option("--database-url-env <name>", "Env var holding the Postgres URL for the record store (default HASNA_<APP>_DATABASE_URL)").option("--table <name>", "api-keys table name (default api_keys)").option("--secrets-ref <template>", "Deliver without plaintext output; template must contain separate {agent} and {kid} path segments").option("--issuance-id <id>", "Stable key id for idempotent retry with --secrets-ref").option("--no-store", "Do not persist the hashed record (print secret + hash only)").option("-j, --json", "Output JSON").action(async (options) => {
    await runIssueKey(options, { report: reportCliError });
  });
  return program2;
}
async function main(argv = process.argv) {
  if (preflightJsonUsageErrors(argv)) {
    return;
  }
  const program2 = createContractsProgram();
  const wantsJson = argvRequestsJson(argv);
  if (wantsJson) {
    program2.configureOutput({
      writeErr: () => {}
    });
  }
  program2.exitOverride();
  try {
    await program2.parseAsync(argv);
  } catch (error2) {
    const commanderError = error2;
    if (error2 instanceof CommanderError || typeof commanderError.code === "string" || typeof commanderError.exitCode === "number") {
      const exitCode = commanderError.exitCode ?? 2;
      if (exitCode === 0) {
        process.exitCode = 0;
        return;
      }
      const code = commanderError.code || "commander_error";
      const message = commanderError.message || "Command failed";
      if (wantsJson) {
        console.log(JSON.stringify({ ok: false, code, error: message }, null, 2));
      } else {
        console.error(message);
      }
      process.exitCode = exitCode;
      return;
    }
    throw error2;
  }
}
if (import.meta.main) {
  await main();
}
export {
  main,
  createContractsProgram
};
