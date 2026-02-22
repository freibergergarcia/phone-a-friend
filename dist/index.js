#!/usr/bin/env node
import { createRequire } from 'module'; const require = createRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/backends/index.ts
import { execFileSync } from "child_process";
function registerBackend(backend) {
  registry.set(backend.name, backend);
}
function getBackend(name) {
  const backend = registry.get(name);
  if (!backend) {
    const supported = [...registry.keys()].sort().join(", ");
    throw new BackendError(
      `Unsupported relay backend: ${name}. Supported: ${supported}`
    );
  }
  return backend;
}
function isInPath(name) {
  try {
    execFileSync("which", [name], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
function checkBackends(whichFn = isInPath) {
  const result = {};
  for (const name of Object.keys(INSTALL_HINTS).sort()) {
    result[name] = whichFn(name);
  }
  return result;
}
var BackendError, INSTALL_HINTS, registry;
var init_backends = __esm({
  "src/backends/index.ts"() {
    "use strict";
    BackendError = class extends Error {
      constructor(message) {
        super(message);
        this.name = "BackendError";
      }
    };
    INSTALL_HINTS = {
      codex: "npm install -g @openai/codex",
      gemini: "npm install -g @google/gemini-cli"
    };
    registry = /* @__PURE__ */ new Map();
  }
});

// node_modules/commander/lib/error.js
var require_error = __commonJS({
  "node_modules/commander/lib/error.js"(exports) {
    "use strict";
    var CommanderError2 = class extends Error {
      /**
       * Constructs the CommanderError class
       * @param {number} exitCode suggested exit code which could be used with process.exit
       * @param {string} code an id string representing the error
       * @param {string} message human-readable description of the error
       */
      constructor(exitCode, code, message) {
        super(message);
        Error.captureStackTrace(this, this.constructor);
        this.name = this.constructor.name;
        this.code = code;
        this.exitCode = exitCode;
        this.nestedError = void 0;
      }
    };
    var InvalidArgumentError2 = class extends CommanderError2 {
      /**
       * Constructs the InvalidArgumentError class
       * @param {string} [message] explanation of why argument is invalid
       */
      constructor(message) {
        super(1, "commander.invalidArgument", message);
        Error.captureStackTrace(this, this.constructor);
        this.name = this.constructor.name;
      }
    };
    exports.CommanderError = CommanderError2;
    exports.InvalidArgumentError = InvalidArgumentError2;
  }
});

// node_modules/commander/lib/argument.js
var require_argument = __commonJS({
  "node_modules/commander/lib/argument.js"(exports) {
    "use strict";
    var { InvalidArgumentError: InvalidArgumentError2 } = require_error();
    var Argument2 = class {
      /**
       * Initialize a new command argument with the given name and description.
       * The default is that the argument is required, and you can explicitly
       * indicate this with <> around the name. Put [] around the name for an optional argument.
       *
       * @param {string} name
       * @param {string} [description]
       */
      constructor(name, description) {
        this.description = description || "";
        this.variadic = false;
        this.parseArg = void 0;
        this.defaultValue = void 0;
        this.defaultValueDescription = void 0;
        this.argChoices = void 0;
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
      /**
       * Return argument name.
       *
       * @return {string}
       */
      name() {
        return this._name;
      }
      /**
       * @package
       */
      _concatValue(value, previous) {
        if (previous === this.defaultValue || !Array.isArray(previous)) {
          return [value];
        }
        return previous.concat(value);
      }
      /**
       * Set the default value, and optionally supply the description to be displayed in the help.
       *
       * @param {*} value
       * @param {string} [description]
       * @return {Argument}
       */
      default(value, description) {
        this.defaultValue = value;
        this.defaultValueDescription = description;
        return this;
      }
      /**
       * Set the custom handler for processing CLI command arguments into argument values.
       *
       * @param {Function} [fn]
       * @return {Argument}
       */
      argParser(fn) {
        this.parseArg = fn;
        return this;
      }
      /**
       * Only allow argument value to be one of choices.
       *
       * @param {string[]} values
       * @return {Argument}
       */
      choices(values) {
        this.argChoices = values.slice();
        this.parseArg = (arg, previous) => {
          if (!this.argChoices.includes(arg)) {
            throw new InvalidArgumentError2(
              `Allowed choices are ${this.argChoices.join(", ")}.`
            );
          }
          if (this.variadic) {
            return this._concatValue(arg, previous);
          }
          return arg;
        };
        return this;
      }
      /**
       * Make argument required.
       *
       * @returns {Argument}
       */
      argRequired() {
        this.required = true;
        return this;
      }
      /**
       * Make argument optional.
       *
       * @returns {Argument}
       */
      argOptional() {
        this.required = false;
        return this;
      }
    };
    function humanReadableArgName(arg) {
      const nameOutput = arg.name() + (arg.variadic === true ? "..." : "");
      return arg.required ? "<" + nameOutput + ">" : "[" + nameOutput + "]";
    }
    exports.Argument = Argument2;
    exports.humanReadableArgName = humanReadableArgName;
  }
});

// node_modules/commander/lib/help.js
var require_help = __commonJS({
  "node_modules/commander/lib/help.js"(exports) {
    "use strict";
    var { humanReadableArgName } = require_argument();
    var Help2 = class {
      constructor() {
        this.helpWidth = void 0;
        this.sortSubcommands = false;
        this.sortOptions = false;
        this.showGlobalOptions = false;
      }
      /**
       * Get an array of the visible subcommands. Includes a placeholder for the implicit help command, if there is one.
       *
       * @param {Command} cmd
       * @returns {Command[]}
       */
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
      /**
       * Compare options for sort.
       *
       * @param {Option} a
       * @param {Option} b
       * @returns {number}
       */
      compareOptions(a, b) {
        const getSortKey = (option) => {
          return option.short ? option.short.replace(/^-/, "") : option.long.replace(/^--/, "");
        };
        return getSortKey(a).localeCompare(getSortKey(b));
      }
      /**
       * Get an array of the visible options. Includes a placeholder for the implicit help option, if there is one.
       *
       * @param {Command} cmd
       * @returns {Option[]}
       */
      visibleOptions(cmd) {
        const visibleOptions = cmd.options.filter((option) => !option.hidden);
        const helpOption = cmd._getHelpOption();
        if (helpOption && !helpOption.hidden) {
          const removeShort = helpOption.short && cmd._findOption(helpOption.short);
          const removeLong = helpOption.long && cmd._findOption(helpOption.long);
          if (!removeShort && !removeLong) {
            visibleOptions.push(helpOption);
          } else if (helpOption.long && !removeLong) {
            visibleOptions.push(
              cmd.createOption(helpOption.long, helpOption.description)
            );
          } else if (helpOption.short && !removeShort) {
            visibleOptions.push(
              cmd.createOption(helpOption.short, helpOption.description)
            );
          }
        }
        if (this.sortOptions) {
          visibleOptions.sort(this.compareOptions);
        }
        return visibleOptions;
      }
      /**
       * Get an array of the visible global options. (Not including help.)
       *
       * @param {Command} cmd
       * @returns {Option[]}
       */
      visibleGlobalOptions(cmd) {
        if (!this.showGlobalOptions) return [];
        const globalOptions = [];
        for (let ancestorCmd = cmd.parent; ancestorCmd; ancestorCmd = ancestorCmd.parent) {
          const visibleOptions = ancestorCmd.options.filter(
            (option) => !option.hidden
          );
          globalOptions.push(...visibleOptions);
        }
        if (this.sortOptions) {
          globalOptions.sort(this.compareOptions);
        }
        return globalOptions;
      }
      /**
       * Get an array of the arguments if any have a description.
       *
       * @param {Command} cmd
       * @returns {Argument[]}
       */
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
      /**
       * Get the command term to show in the list of subcommands.
       *
       * @param {Command} cmd
       * @returns {string}
       */
      subcommandTerm(cmd) {
        const args = cmd.registeredArguments.map((arg) => humanReadableArgName(arg)).join(" ");
        return cmd._name + (cmd._aliases[0] ? "|" + cmd._aliases[0] : "") + (cmd.options.length ? " [options]" : "") + // simplistic check for non-help option
        (args ? " " + args : "");
      }
      /**
       * Get the option term to show in the list of options.
       *
       * @param {Option} option
       * @returns {string}
       */
      optionTerm(option) {
        return option.flags;
      }
      /**
       * Get the argument term to show in the list of arguments.
       *
       * @param {Argument} argument
       * @returns {string}
       */
      argumentTerm(argument) {
        return argument.name();
      }
      /**
       * Get the longest command term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestSubcommandTermLength(cmd, helper) {
        return helper.visibleCommands(cmd).reduce((max, command) => {
          return Math.max(max, helper.subcommandTerm(command).length);
        }, 0);
      }
      /**
       * Get the longest option term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestOptionTermLength(cmd, helper) {
        return helper.visibleOptions(cmd).reduce((max, option) => {
          return Math.max(max, helper.optionTerm(option).length);
        }, 0);
      }
      /**
       * Get the longest global option term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestGlobalOptionTermLength(cmd, helper) {
        return helper.visibleGlobalOptions(cmd).reduce((max, option) => {
          return Math.max(max, helper.optionTerm(option).length);
        }, 0);
      }
      /**
       * Get the longest argument term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestArgumentTermLength(cmd, helper) {
        return helper.visibleArguments(cmd).reduce((max, argument) => {
          return Math.max(max, helper.argumentTerm(argument).length);
        }, 0);
      }
      /**
       * Get the command usage to be displayed at the top of the built-in help.
       *
       * @param {Command} cmd
       * @returns {string}
       */
      commandUsage(cmd) {
        let cmdName = cmd._name;
        if (cmd._aliases[0]) {
          cmdName = cmdName + "|" + cmd._aliases[0];
        }
        let ancestorCmdNames = "";
        for (let ancestorCmd = cmd.parent; ancestorCmd; ancestorCmd = ancestorCmd.parent) {
          ancestorCmdNames = ancestorCmd.name() + " " + ancestorCmdNames;
        }
        return ancestorCmdNames + cmdName + " " + cmd.usage();
      }
      /**
       * Get the description for the command.
       *
       * @param {Command} cmd
       * @returns {string}
       */
      commandDescription(cmd) {
        return cmd.description();
      }
      /**
       * Get the subcommand summary to show in the list of subcommands.
       * (Fallback to description for backwards compatibility.)
       *
       * @param {Command} cmd
       * @returns {string}
       */
      subcommandDescription(cmd) {
        return cmd.summary() || cmd.description();
      }
      /**
       * Get the option description to show in the list of options.
       *
       * @param {Option} option
       * @return {string}
       */
      optionDescription(option) {
        const extraInfo = [];
        if (option.argChoices) {
          extraInfo.push(
            // use stringify to match the display of the default value
            `choices: ${option.argChoices.map((choice) => JSON.stringify(choice)).join(", ")}`
          );
        }
        if (option.defaultValue !== void 0) {
          const showDefault = option.required || option.optional || option.isBoolean() && typeof option.defaultValue === "boolean";
          if (showDefault) {
            extraInfo.push(
              `default: ${option.defaultValueDescription || JSON.stringify(option.defaultValue)}`
            );
          }
        }
        if (option.presetArg !== void 0 && option.optional) {
          extraInfo.push(`preset: ${JSON.stringify(option.presetArg)}`);
        }
        if (option.envVar !== void 0) {
          extraInfo.push(`env: ${option.envVar}`);
        }
        if (extraInfo.length > 0) {
          return `${option.description} (${extraInfo.join(", ")})`;
        }
        return option.description;
      }
      /**
       * Get the argument description to show in the list of arguments.
       *
       * @param {Argument} argument
       * @return {string}
       */
      argumentDescription(argument) {
        const extraInfo = [];
        if (argument.argChoices) {
          extraInfo.push(
            // use stringify to match the display of the default value
            `choices: ${argument.argChoices.map((choice) => JSON.stringify(choice)).join(", ")}`
          );
        }
        if (argument.defaultValue !== void 0) {
          extraInfo.push(
            `default: ${argument.defaultValueDescription || JSON.stringify(argument.defaultValue)}`
          );
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
      /**
       * Generate the built-in help text.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {string}
       */
      formatHelp(cmd, helper) {
        const termWidth = helper.padWidth(cmd, helper);
        const helpWidth = helper.helpWidth || 80;
        const itemIndentWidth = 2;
        const itemSeparatorWidth = 2;
        function formatItem(term, description) {
          if (description) {
            const fullText = `${term.padEnd(termWidth + itemSeparatorWidth)}${description}`;
            return helper.wrap(
              fullText,
              helpWidth - itemIndentWidth,
              termWidth + itemSeparatorWidth
            );
          }
          return term;
        }
        function formatList(textArray) {
          return textArray.join("\n").replace(/^/gm, " ".repeat(itemIndentWidth));
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
          return formatItem(
            helper.argumentTerm(argument),
            helper.argumentDescription(argument)
          );
        });
        if (argumentList.length > 0) {
          output = output.concat(["Arguments:", formatList(argumentList), ""]);
        }
        const optionList = helper.visibleOptions(cmd).map((option) => {
          return formatItem(
            helper.optionTerm(option),
            helper.optionDescription(option)
          );
        });
        if (optionList.length > 0) {
          output = output.concat(["Options:", formatList(optionList), ""]);
        }
        if (this.showGlobalOptions) {
          const globalOptionList = helper.visibleGlobalOptions(cmd).map((option) => {
            return formatItem(
              helper.optionTerm(option),
              helper.optionDescription(option)
            );
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
          return formatItem(
            helper.subcommandTerm(cmd2),
            helper.subcommandDescription(cmd2)
          );
        });
        if (commandList.length > 0) {
          output = output.concat(["Commands:", formatList(commandList), ""]);
        }
        return output.join("\n");
      }
      /**
       * Calculate the pad width from the maximum term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      padWidth(cmd, helper) {
        return Math.max(
          helper.longestOptionTermLength(cmd, helper),
          helper.longestGlobalOptionTermLength(cmd, helper),
          helper.longestSubcommandTermLength(cmd, helper),
          helper.longestArgumentTermLength(cmd, helper)
        );
      }
      /**
       * Wrap the given string to width characters per line, with lines after the first indented.
       * Do not wrap if insufficient room for wrapping (minColumnWidth), or string is manually formatted.
       *
       * @param {string} str
       * @param {number} width
       * @param {number} indent
       * @param {number} [minColumnWidth=40]
       * @return {string}
       *
       */
      wrap(str, width, indent, minColumnWidth = 40) {
        const indents = " \\f\\t\\v\xA0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF";
        const manualIndent = new RegExp(`[\\n][${indents}]+`);
        if (str.match(manualIndent)) return str;
        const columnWidth = width - indent;
        if (columnWidth < minColumnWidth) return str;
        const leadingStr = str.slice(0, indent);
        const columnText = str.slice(indent).replace("\r\n", "\n");
        const indentString = " ".repeat(indent);
        const zeroWidthSpace = "\u200B";
        const breaks = `\\s${zeroWidthSpace}`;
        const regex2 = new RegExp(
          `
|.{1,${columnWidth - 1}}([${breaks}]|$)|[^${breaks}]+?([${breaks}]|$)`,
          "g"
        );
        const lines = columnText.match(regex2) || [];
        return leadingStr + lines.map((line, i) => {
          if (line === "\n") return "";
          return (i > 0 ? indentString : "") + line.trimEnd();
        }).join("\n");
      }
    };
    exports.Help = Help2;
  }
});

// node_modules/commander/lib/option.js
var require_option = __commonJS({
  "node_modules/commander/lib/option.js"(exports) {
    "use strict";
    var { InvalidArgumentError: InvalidArgumentError2 } = require_error();
    var Option2 = class {
      /**
       * Initialize a new `Option` with the given `flags` and `description`.
       *
       * @param {string} flags
       * @param {string} [description]
       */
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
        this.defaultValue = void 0;
        this.defaultValueDescription = void 0;
        this.presetArg = void 0;
        this.envVar = void 0;
        this.parseArg = void 0;
        this.hidden = false;
        this.argChoices = void 0;
        this.conflictsWith = [];
        this.implied = void 0;
      }
      /**
       * Set the default value, and optionally supply the description to be displayed in the help.
       *
       * @param {*} value
       * @param {string} [description]
       * @return {Option}
       */
      default(value, description) {
        this.defaultValue = value;
        this.defaultValueDescription = description;
        return this;
      }
      /**
       * Preset to use when option used without option-argument, especially optional but also boolean and negated.
       * The custom processing (parseArg) is called.
       *
       * @example
       * new Option('--color').default('GREYSCALE').preset('RGB');
       * new Option('--donate [amount]').preset('20').argParser(parseFloat);
       *
       * @param {*} arg
       * @return {Option}
       */
      preset(arg) {
        this.presetArg = arg;
        return this;
      }
      /**
       * Add option name(s) that conflict with this option.
       * An error will be displayed if conflicting options are found during parsing.
       *
       * @example
       * new Option('--rgb').conflicts('cmyk');
       * new Option('--js').conflicts(['ts', 'jsx']);
       *
       * @param {(string | string[])} names
       * @return {Option}
       */
      conflicts(names) {
        this.conflictsWith = this.conflictsWith.concat(names);
        return this;
      }
      /**
       * Specify implied option values for when this option is set and the implied options are not.
       *
       * The custom processing (parseArg) is not called on the implied values.
       *
       * @example
       * program
       *   .addOption(new Option('--log', 'write logging information to file'))
       *   .addOption(new Option('--trace', 'log extra details').implies({ log: 'trace.txt' }));
       *
       * @param {object} impliedOptionValues
       * @return {Option}
       */
      implies(impliedOptionValues) {
        let newImplied = impliedOptionValues;
        if (typeof impliedOptionValues === "string") {
          newImplied = { [impliedOptionValues]: true };
        }
        this.implied = Object.assign(this.implied || {}, newImplied);
        return this;
      }
      /**
       * Set environment variable to check for option value.
       *
       * An environment variable is only used if when processed the current option value is
       * undefined, or the source of the current value is 'default' or 'config' or 'env'.
       *
       * @param {string} name
       * @return {Option}
       */
      env(name) {
        this.envVar = name;
        return this;
      }
      /**
       * Set the custom handler for processing CLI option arguments into option values.
       *
       * @param {Function} [fn]
       * @return {Option}
       */
      argParser(fn) {
        this.parseArg = fn;
        return this;
      }
      /**
       * Whether the option is mandatory and must have a value after parsing.
       *
       * @param {boolean} [mandatory=true]
       * @return {Option}
       */
      makeOptionMandatory(mandatory = true) {
        this.mandatory = !!mandatory;
        return this;
      }
      /**
       * Hide option in help.
       *
       * @param {boolean} [hide=true]
       * @return {Option}
       */
      hideHelp(hide = true) {
        this.hidden = !!hide;
        return this;
      }
      /**
       * @package
       */
      _concatValue(value, previous) {
        if (previous === this.defaultValue || !Array.isArray(previous)) {
          return [value];
        }
        return previous.concat(value);
      }
      /**
       * Only allow option value to be one of choices.
       *
       * @param {string[]} values
       * @return {Option}
       */
      choices(values) {
        this.argChoices = values.slice();
        this.parseArg = (arg, previous) => {
          if (!this.argChoices.includes(arg)) {
            throw new InvalidArgumentError2(
              `Allowed choices are ${this.argChoices.join(", ")}.`
            );
          }
          if (this.variadic) {
            return this._concatValue(arg, previous);
          }
          return arg;
        };
        return this;
      }
      /**
       * Return option name.
       *
       * @return {string}
       */
      name() {
        if (this.long) {
          return this.long.replace(/^--/, "");
        }
        return this.short.replace(/^-/, "");
      }
      /**
       * Return option name, in a camelcase format that can be used
       * as a object attribute key.
       *
       * @return {string}
       */
      attributeName() {
        return camelcase(this.name().replace(/^no-/, ""));
      }
      /**
       * Check if `arg` matches the short or long flag.
       *
       * @param {string} arg
       * @return {boolean}
       * @package
       */
      is(arg) {
        return this.short === arg || this.long === arg;
      }
      /**
       * Return whether a boolean option.
       *
       * Options are one of boolean, negated, required argument, or optional argument.
       *
       * @return {boolean}
       * @package
       */
      isBoolean() {
        return !this.required && !this.optional && !this.negate;
      }
    };
    var DualOptions = class {
      /**
       * @param {Option[]} options
       */
      constructor(options) {
        this.positiveOptions = /* @__PURE__ */ new Map();
        this.negativeOptions = /* @__PURE__ */ new Map();
        this.dualOptions = /* @__PURE__ */ new Set();
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
      /**
       * Did the value come from the option, and not from possible matching dual option?
       *
       * @param {*} value
       * @param {Option} option
       * @returns {boolean}
       */
      valueFromOption(value, option) {
        const optionKey = option.attributeName();
        if (!this.dualOptions.has(optionKey)) return true;
        const preset = this.negativeOptions.get(optionKey).presetArg;
        const negativeValue = preset !== void 0 ? preset : false;
        return option.negate === (negativeValue === value);
      }
    };
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
        longFlag = void 0;
      }
      return { shortFlag, longFlag };
    }
    exports.Option = Option2;
    exports.DualOptions = DualOptions;
  }
});

// node_modules/commander/lib/suggestSimilar.js
var require_suggestSimilar = __commonJS({
  "node_modules/commander/lib/suggestSimilar.js"(exports) {
    "use strict";
    var maxDistance = 3;
    function editDistance(a, b) {
      if (Math.abs(a.length - b.length) > maxDistance)
        return Math.max(a.length, b.length);
      const d = [];
      for (let i = 0; i <= a.length; i++) {
        d[i] = [i];
      }
      for (let j = 0; j <= b.length; j++) {
        d[0][j] = j;
      }
      for (let j = 1; j <= b.length; j++) {
        for (let i = 1; i <= a.length; i++) {
          let cost = 1;
          if (a[i - 1] === b[j - 1]) {
            cost = 0;
          } else {
            cost = 1;
          }
          d[i][j] = Math.min(
            d[i - 1][j] + 1,
            // deletion
            d[i][j - 1] + 1,
            // insertion
            d[i - 1][j - 1] + cost
            // substitution
          );
          if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
            d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
          }
        }
      }
      return d[a.length][b.length];
    }
    function suggestSimilar(word, candidates) {
      if (!candidates || candidates.length === 0) return "";
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
        if (candidate.length <= 1) return;
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
  }
});

// node_modules/commander/lib/command.js
var require_command = __commonJS({
  "node_modules/commander/lib/command.js"(exports) {
    "use strict";
    var EventEmitter = __require("events").EventEmitter;
    var childProcess = __require("child_process");
    var path = __require("path");
    var fs = __require("fs");
    var process10 = __require("process");
    var { Argument: Argument2, humanReadableArgName } = require_argument();
    var { CommanderError: CommanderError2 } = require_error();
    var { Help: Help2 } = require_help();
    var { Option: Option2, DualOptions } = require_option();
    var { suggestSimilar } = require_suggestSimilar();
    var Command2 = class _Command extends EventEmitter {
      /**
       * Initialize a new `Command`.
       *
       * @param {string} [name]
       */
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
        this._argsDescription = void 0;
        this._enablePositionalOptions = false;
        this._passThroughOptions = false;
        this._lifeCycleHooks = {};
        this._showHelpAfterError = false;
        this._showSuggestionAfterError = true;
        this._outputConfiguration = {
          writeOut: (str) => process10.stdout.write(str),
          writeErr: (str) => process10.stderr.write(str),
          getOutHelpWidth: () => process10.stdout.isTTY ? process10.stdout.columns : void 0,
          getErrHelpWidth: () => process10.stderr.isTTY ? process10.stderr.columns : void 0,
          outputError: (str, write) => write(str)
        };
        this._hidden = false;
        this._helpOption = void 0;
        this._addImplicitHelpCommand = void 0;
        this._helpCommand = void 0;
        this._helpConfiguration = {};
      }
      /**
       * Copy settings that are useful to have in common across root command and subcommands.
       *
       * (Used internally when adding a command using `.command()` so subcommands inherit parent settings.)
       *
       * @param {Command} sourceCommand
       * @return {Command} `this` command for chaining
       */
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
      /**
       * @returns {Command[]}
       * @private
       */
      _getCommandAndAncestors() {
        const result = [];
        for (let command = this; command; command = command.parent) {
          result.push(command);
        }
        return result;
      }
      /**
       * Define a command.
       *
       * There are two styles of command: pay attention to where to put the description.
       *
       * @example
       * // Command implemented using action handler (description is supplied separately to `.command`)
       * program
       *   .command('clone <source> [destination]')
       *   .description('clone a repository into a newly created directory')
       *   .action((source, destination) => {
       *     console.log('clone command called');
       *   });
       *
       * // Command implemented using separate executable file (description is second parameter to `.command`)
       * program
       *   .command('start <service>', 'start named service')
       *   .command('stop [service]', 'stop named service, or all if no name supplied');
       *
       * @param {string} nameAndArgs - command name and arguments, args are `<required>` or `[optional]` and last may also be `variadic...`
       * @param {(object | string)} [actionOptsOrExecDesc] - configuration options (for action), or description (for executable)
       * @param {object} [execOpts] - configuration options (for executable)
       * @return {Command} returns new command for action handler, or `this` for executable command
       */
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
        if (opts.isDefault) this._defaultCommandName = cmd._name;
        cmd._hidden = !!(opts.noHelp || opts.hidden);
        cmd._executableFile = opts.executableFile || null;
        if (args) cmd.arguments(args);
        this._registerCommand(cmd);
        cmd.parent = this;
        cmd.copyInheritedSettings(this);
        if (desc) return this;
        return cmd;
      }
      /**
       * Factory routine to create a new unattached command.
       *
       * See .command() for creating an attached subcommand, which uses this routine to
       * create the command. You can override createCommand to customise subcommands.
       *
       * @param {string} [name]
       * @return {Command} new command
       */
      createCommand(name) {
        return new _Command(name);
      }
      /**
       * You can customise the help with a subclass of Help by overriding createHelp,
       * or by overriding Help properties using configureHelp().
       *
       * @return {Help}
       */
      createHelp() {
        return Object.assign(new Help2(), this.configureHelp());
      }
      /**
       * You can customise the help by overriding Help properties using configureHelp(),
       * or with a subclass of Help by overriding createHelp().
       *
       * @param {object} [configuration] - configuration options
       * @return {(Command | object)} `this` command for chaining, or stored configuration
       */
      configureHelp(configuration) {
        if (configuration === void 0) return this._helpConfiguration;
        this._helpConfiguration = configuration;
        return this;
      }
      /**
       * The default output goes to stdout and stderr. You can customise this for special
       * applications. You can also customise the display of errors by overriding outputError.
       *
       * The configuration properties are all functions:
       *
       *     // functions to change where being written, stdout and stderr
       *     writeOut(str)
       *     writeErr(str)
       *     // matching functions to specify width for wrapping help
       *     getOutHelpWidth()
       *     getErrHelpWidth()
       *     // functions based on what is being written out
       *     outputError(str, write) // used for displaying errors, and not used for displaying help
       *
       * @param {object} [configuration] - configuration options
       * @return {(Command | object)} `this` command for chaining, or stored configuration
       */
      configureOutput(configuration) {
        if (configuration === void 0) return this._outputConfiguration;
        Object.assign(this._outputConfiguration, configuration);
        return this;
      }
      /**
       * Display the help or a custom message after an error occurs.
       *
       * @param {(boolean|string)} [displayHelp]
       * @return {Command} `this` command for chaining
       */
      showHelpAfterError(displayHelp = true) {
        if (typeof displayHelp !== "string") displayHelp = !!displayHelp;
        this._showHelpAfterError = displayHelp;
        return this;
      }
      /**
       * Display suggestion of similar commands for unknown commands, or options for unknown options.
       *
       * @param {boolean} [displaySuggestion]
       * @return {Command} `this` command for chaining
       */
      showSuggestionAfterError(displaySuggestion = true) {
        this._showSuggestionAfterError = !!displaySuggestion;
        return this;
      }
      /**
       * Add a prepared subcommand.
       *
       * See .command() for creating an attached subcommand which inherits settings from its parent.
       *
       * @param {Command} cmd - new subcommand
       * @param {object} [opts] - configuration options
       * @return {Command} `this` command for chaining
       */
      addCommand(cmd, opts) {
        if (!cmd._name) {
          throw new Error(`Command passed to .addCommand() must have a name
- specify the name in Command constructor or using .name()`);
        }
        opts = opts || {};
        if (opts.isDefault) this._defaultCommandName = cmd._name;
        if (opts.noHelp || opts.hidden) cmd._hidden = true;
        this._registerCommand(cmd);
        cmd.parent = this;
        cmd._checkForBrokenPassThrough();
        return this;
      }
      /**
       * Factory routine to create a new unattached argument.
       *
       * See .argument() for creating an attached argument, which uses this routine to
       * create the argument. You can override createArgument to return a custom argument.
       *
       * @param {string} name
       * @param {string} [description]
       * @return {Argument} new argument
       */
      createArgument(name, description) {
        return new Argument2(name, description);
      }
      /**
       * Define argument syntax for command.
       *
       * The default is that the argument is required, and you can explicitly
       * indicate this with <> around the name. Put [] around the name for an optional argument.
       *
       * @example
       * program.argument('<input-file>');
       * program.argument('[output-file]');
       *
       * @param {string} name
       * @param {string} [description]
       * @param {(Function|*)} [fn] - custom argument processing function
       * @param {*} [defaultValue]
       * @return {Command} `this` command for chaining
       */
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
      /**
       * Define argument syntax for command, adding multiple at once (without descriptions).
       *
       * See also .argument().
       *
       * @example
       * program.arguments('<cmd> [env]');
       *
       * @param {string} names
       * @return {Command} `this` command for chaining
       */
      arguments(names) {
        names.trim().split(/ +/).forEach((detail) => {
          this.argument(detail);
        });
        return this;
      }
      /**
       * Define argument syntax for command, adding a prepared argument.
       *
       * @param {Argument} argument
       * @return {Command} `this` command for chaining
       */
      addArgument(argument) {
        const previousArgument = this.registeredArguments.slice(-1)[0];
        if (previousArgument && previousArgument.variadic) {
          throw new Error(
            `only the last argument can be variadic '${previousArgument.name()}'`
          );
        }
        if (argument.required && argument.defaultValue !== void 0 && argument.parseArg === void 0) {
          throw new Error(
            `a default value for a required argument is never used: '${argument.name()}'`
          );
        }
        this.registeredArguments.push(argument);
        return this;
      }
      /**
       * Customise or override default help command. By default a help command is automatically added if your command has subcommands.
       *
       * @example
       *    program.helpCommand('help [cmd]');
       *    program.helpCommand('help [cmd]', 'show help');
       *    program.helpCommand(false); // suppress default help command
       *    program.helpCommand(true); // add help command even if no subcommands
       *
       * @param {string|boolean} enableOrNameAndArgs - enable with custom name and/or arguments, or boolean to override whether added
       * @param {string} [description] - custom description
       * @return {Command} `this` command for chaining
       */
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
        if (helpArgs) helpCommand.arguments(helpArgs);
        if (helpDescription) helpCommand.description(helpDescription);
        this._addImplicitHelpCommand = true;
        this._helpCommand = helpCommand;
        return this;
      }
      /**
       * Add prepared custom help command.
       *
       * @param {(Command|string|boolean)} helpCommand - custom help command, or deprecated enableOrNameAndArgs as for `.helpCommand()`
       * @param {string} [deprecatedDescription] - deprecated custom description used with custom name only
       * @return {Command} `this` command for chaining
       */
      addHelpCommand(helpCommand, deprecatedDescription) {
        if (typeof helpCommand !== "object") {
          this.helpCommand(helpCommand, deprecatedDescription);
          return this;
        }
        this._addImplicitHelpCommand = true;
        this._helpCommand = helpCommand;
        return this;
      }
      /**
       * Lazy create help command.
       *
       * @return {(Command|null)}
       * @package
       */
      _getHelpCommand() {
        const hasImplicitHelpCommand = this._addImplicitHelpCommand ?? (this.commands.length && !this._actionHandler && !this._findCommand("help"));
        if (hasImplicitHelpCommand) {
          if (this._helpCommand === void 0) {
            this.helpCommand(void 0, void 0);
          }
          return this._helpCommand;
        }
        return null;
      }
      /**
       * Add hook for life cycle event.
       *
       * @param {string} event
       * @param {Function} listener
       * @return {Command} `this` command for chaining
       */
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
      /**
       * Register callback to use as replacement for calling process.exit.
       *
       * @param {Function} [fn] optional callback which will be passed a CommanderError, defaults to throwing
       * @return {Command} `this` command for chaining
       */
      exitOverride(fn) {
        if (fn) {
          this._exitCallback = fn;
        } else {
          this._exitCallback = (err) => {
            if (err.code !== "commander.executeSubCommandAsync") {
              throw err;
            } else {
            }
          };
        }
        return this;
      }
      /**
       * Call process.exit, and _exitCallback if defined.
       *
       * @param {number} exitCode exit code for using with process.exit
       * @param {string} code an id string representing the error
       * @param {string} message human-readable description of the error
       * @return never
       * @private
       */
      _exit(exitCode, code, message) {
        if (this._exitCallback) {
          this._exitCallback(new CommanderError2(exitCode, code, message));
        }
        process10.exit(exitCode);
      }
      /**
       * Register callback `fn` for the command.
       *
       * @example
       * program
       *   .command('serve')
       *   .description('start service')
       *   .action(function() {
       *      // do work here
       *   });
       *
       * @param {Function} fn
       * @return {Command} `this` command for chaining
       */
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
      /**
       * Factory routine to create a new unattached option.
       *
       * See .option() for creating an attached option, which uses this routine to
       * create the option. You can override createOption to return a custom option.
       *
       * @param {string} flags
       * @param {string} [description]
       * @return {Option} new option
       */
      createOption(flags, description) {
        return new Option2(flags, description);
      }
      /**
       * Wrap parseArgs to catch 'commander.invalidArgument'.
       *
       * @param {(Option | Argument)} target
       * @param {string} value
       * @param {*} previous
       * @param {string} invalidArgumentMessage
       * @private
       */
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
      /**
       * Check for option flag conflicts.
       * Register option if no conflicts found, or throw on conflict.
       *
       * @param {Option} option
       * @private
       */
      _registerOption(option) {
        const matchingOption = option.short && this._findOption(option.short) || option.long && this._findOption(option.long);
        if (matchingOption) {
          const matchingFlag = option.long && this._findOption(option.long) ? option.long : option.short;
          throw new Error(`Cannot add option '${option.flags}'${this._name && ` to command '${this._name}'`} due to conflicting flag '${matchingFlag}'
-  already used by option '${matchingOption.flags}'`);
        }
        this.options.push(option);
      }
      /**
       * Check for command name and alias conflicts with existing commands.
       * Register command if no conflicts found, or throw on conflict.
       *
       * @param {Command} command
       * @private
       */
      _registerCommand(command) {
        const knownBy = (cmd) => {
          return [cmd.name()].concat(cmd.aliases());
        };
        const alreadyUsed = knownBy(command).find(
          (name) => this._findCommand(name)
        );
        if (alreadyUsed) {
          const existingCmd = knownBy(this._findCommand(alreadyUsed)).join("|");
          const newCmd = knownBy(command).join("|");
          throw new Error(
            `cannot add command '${newCmd}' as already have command '${existingCmd}'`
          );
        }
        this.commands.push(command);
      }
      /**
       * Add an option.
       *
       * @param {Option} option
       * @return {Command} `this` command for chaining
       */
      addOption(option) {
        this._registerOption(option);
        const oname = option.name();
        const name = option.attributeName();
        if (option.negate) {
          const positiveLongFlag = option.long.replace(/^--no-/, "--");
          if (!this._findOption(positiveLongFlag)) {
            this.setOptionValueWithSource(
              name,
              option.defaultValue === void 0 ? true : option.defaultValue,
              "default"
            );
          }
        } else if (option.defaultValue !== void 0) {
          this.setOptionValueWithSource(name, option.defaultValue, "default");
        }
        const handleOptionValue = (val, invalidValueMessage, valueSource) => {
          if (val == null && option.presetArg !== void 0) {
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
      /**
       * Internal implementation shared by .option() and .requiredOption()
       *
       * @return {Command} `this` command for chaining
       * @private
       */
      _optionEx(config, flags, description, fn, defaultValue) {
        if (typeof flags === "object" && flags instanceof Option2) {
          throw new Error(
            "To add an Option object use addOption() instead of option() or requiredOption()"
          );
        }
        const option = this.createOption(flags, description);
        option.makeOptionMandatory(!!config.mandatory);
        if (typeof fn === "function") {
          option.default(defaultValue).argParser(fn);
        } else if (fn instanceof RegExp) {
          const regex2 = fn;
          fn = (val, def) => {
            const m = regex2.exec(val);
            return m ? m[0] : def;
          };
          option.default(defaultValue).argParser(fn);
        } else {
          option.default(fn);
        }
        return this.addOption(option);
      }
      /**
       * Define option with `flags`, `description`, and optional argument parsing function or `defaultValue` or both.
       *
       * The `flags` string contains the short and/or long flags, separated by comma, a pipe or space. A required
       * option-argument is indicated by `<>` and an optional option-argument by `[]`.
       *
       * See the README for more details, and see also addOption() and requiredOption().
       *
       * @example
       * program
       *     .option('-p, --pepper', 'add pepper')
       *     .option('-p, --pizza-type <TYPE>', 'type of pizza') // required option-argument
       *     .option('-c, --cheese [CHEESE]', 'add extra cheese', 'mozzarella') // optional option-argument with default
       *     .option('-t, --tip <VALUE>', 'add tip to purchase cost', parseFloat) // custom parse function
       *
       * @param {string} flags
       * @param {string} [description]
       * @param {(Function|*)} [parseArg] - custom option processing function or default value
       * @param {*} [defaultValue]
       * @return {Command} `this` command for chaining
       */
      option(flags, description, parseArg, defaultValue) {
        return this._optionEx({}, flags, description, parseArg, defaultValue);
      }
      /**
       * Add a required option which must have a value after parsing. This usually means
       * the option must be specified on the command line. (Otherwise the same as .option().)
       *
       * The `flags` string contains the short and/or long flags, separated by comma, a pipe or space.
       *
       * @param {string} flags
       * @param {string} [description]
       * @param {(Function|*)} [parseArg] - custom option processing function or default value
       * @param {*} [defaultValue]
       * @return {Command} `this` command for chaining
       */
      requiredOption(flags, description, parseArg, defaultValue) {
        return this._optionEx(
          { mandatory: true },
          flags,
          description,
          parseArg,
          defaultValue
        );
      }
      /**
       * Alter parsing of short flags with optional values.
       *
       * @example
       * // for `.option('-f,--flag [value]'):
       * program.combineFlagAndOptionalValue(true);  // `-f80` is treated like `--flag=80`, this is the default behaviour
       * program.combineFlagAndOptionalValue(false) // `-fb` is treated like `-f -b`
       *
       * @param {boolean} [combine] - if `true` or omitted, an optional value can be specified directly after the flag.
       * @return {Command} `this` command for chaining
       */
      combineFlagAndOptionalValue(combine = true) {
        this._combineFlagAndOptionalValue = !!combine;
        return this;
      }
      /**
       * Allow unknown options on the command line.
       *
       * @param {boolean} [allowUnknown] - if `true` or omitted, no error will be thrown for unknown options.
       * @return {Command} `this` command for chaining
       */
      allowUnknownOption(allowUnknown = true) {
        this._allowUnknownOption = !!allowUnknown;
        return this;
      }
      /**
       * Allow excess command-arguments on the command line. Pass false to make excess arguments an error.
       *
       * @param {boolean} [allowExcess] - if `true` or omitted, no error will be thrown for excess arguments.
       * @return {Command} `this` command for chaining
       */
      allowExcessArguments(allowExcess = true) {
        this._allowExcessArguments = !!allowExcess;
        return this;
      }
      /**
       * Enable positional options. Positional means global options are specified before subcommands which lets
       * subcommands reuse the same option names, and also enables subcommands to turn on passThroughOptions.
       * The default behaviour is non-positional and global options may appear anywhere on the command line.
       *
       * @param {boolean} [positional]
       * @return {Command} `this` command for chaining
       */
      enablePositionalOptions(positional = true) {
        this._enablePositionalOptions = !!positional;
        return this;
      }
      /**
       * Pass through options that come after command-arguments rather than treat them as command-options,
       * so actual command-options come before command-arguments. Turning this on for a subcommand requires
       * positional options to have been enabled on the program (parent commands).
       * The default behaviour is non-positional and options may appear before or after command-arguments.
       *
       * @param {boolean} [passThrough] for unknown options.
       * @return {Command} `this` command for chaining
       */
      passThroughOptions(passThrough = true) {
        this._passThroughOptions = !!passThrough;
        this._checkForBrokenPassThrough();
        return this;
      }
      /**
       * @private
       */
      _checkForBrokenPassThrough() {
        if (this.parent && this._passThroughOptions && !this.parent._enablePositionalOptions) {
          throw new Error(
            `passThroughOptions cannot be used for '${this._name}' without turning on enablePositionalOptions for parent command(s)`
          );
        }
      }
      /**
       * Whether to store option values as properties on command object,
       * or store separately (specify false). In both cases the option values can be accessed using .opts().
       *
       * @param {boolean} [storeAsProperties=true]
       * @return {Command} `this` command for chaining
       */
      storeOptionsAsProperties(storeAsProperties = true) {
        if (this.options.length) {
          throw new Error("call .storeOptionsAsProperties() before adding options");
        }
        if (Object.keys(this._optionValues).length) {
          throw new Error(
            "call .storeOptionsAsProperties() before setting option values"
          );
        }
        this._storeOptionsAsProperties = !!storeAsProperties;
        return this;
      }
      /**
       * Retrieve option value.
       *
       * @param {string} key
       * @return {object} value
       */
      getOptionValue(key) {
        if (this._storeOptionsAsProperties) {
          return this[key];
        }
        return this._optionValues[key];
      }
      /**
       * Store option value.
       *
       * @param {string} key
       * @param {object} value
       * @return {Command} `this` command for chaining
       */
      setOptionValue(key, value) {
        return this.setOptionValueWithSource(key, value, void 0);
      }
      /**
       * Store option value and where the value came from.
       *
       * @param {string} key
       * @param {object} value
       * @param {string} source - expected values are default/config/env/cli/implied
       * @return {Command} `this` command for chaining
       */
      setOptionValueWithSource(key, value, source) {
        if (this._storeOptionsAsProperties) {
          this[key] = value;
        } else {
          this._optionValues[key] = value;
        }
        this._optionValueSources[key] = source;
        return this;
      }
      /**
       * Get source of option value.
       * Expected values are default | config | env | cli | implied
       *
       * @param {string} key
       * @return {string}
       */
      getOptionValueSource(key) {
        return this._optionValueSources[key];
      }
      /**
       * Get source of option value. See also .optsWithGlobals().
       * Expected values are default | config | env | cli | implied
       *
       * @param {string} key
       * @return {string}
       */
      getOptionValueSourceWithGlobals(key) {
        let source;
        this._getCommandAndAncestors().forEach((cmd) => {
          if (cmd.getOptionValueSource(key) !== void 0) {
            source = cmd.getOptionValueSource(key);
          }
        });
        return source;
      }
      /**
       * Get user arguments from implied or explicit arguments.
       * Side-effects: set _scriptPath if args included script. Used for default program name, and subcommand searches.
       *
       * @private
       */
      _prepareUserArgs(argv, parseOptions) {
        if (argv !== void 0 && !Array.isArray(argv)) {
          throw new Error("first parameter to parse must be array or undefined");
        }
        parseOptions = parseOptions || {};
        if (argv === void 0 && parseOptions.from === void 0) {
          if (process10.versions?.electron) {
            parseOptions.from = "electron";
          }
          const execArgv = process10.execArgv ?? [];
          if (execArgv.includes("-e") || execArgv.includes("--eval") || execArgv.includes("-p") || execArgv.includes("--print")) {
            parseOptions.from = "eval";
          }
        }
        if (argv === void 0) {
          argv = process10.argv;
        }
        this.rawArgs = argv.slice();
        let userArgs;
        switch (parseOptions.from) {
          case void 0:
          case "node":
            this._scriptPath = argv[1];
            userArgs = argv.slice(2);
            break;
          case "electron":
            if (process10.defaultApp) {
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
            throw new Error(
              `unexpected parse option { from: '${parseOptions.from}' }`
            );
        }
        if (!this._name && this._scriptPath)
          this.nameFromFilename(this._scriptPath);
        this._name = this._name || "program";
        return userArgs;
      }
      /**
       * Parse `argv`, setting options and invoking commands when defined.
       *
       * Use parseAsync instead of parse if any of your action handlers are async.
       *
       * Call with no parameters to parse `process.argv`. Detects Electron and special node options like `node --eval`. Easy mode!
       *
       * Or call with an array of strings to parse, and optionally where the user arguments start by specifying where the arguments are `from`:
       * - `'node'`: default, `argv[0]` is the application and `argv[1]` is the script being run, with user arguments after that
       * - `'electron'`: `argv[0]` is the application and `argv[1]` varies depending on whether the electron application is packaged
       * - `'user'`: just user arguments
       *
       * @example
       * program.parse(); // parse process.argv and auto-detect electron and special node flags
       * program.parse(process.argv); // assume argv[0] is app and argv[1] is script
       * program.parse(my-args, { from: 'user' }); // just user supplied arguments, nothing special about argv[0]
       *
       * @param {string[]} [argv] - optional, defaults to process.argv
       * @param {object} [parseOptions] - optionally specify style of options with from: node/user/electron
       * @param {string} [parseOptions.from] - where the args are from: 'node', 'user', 'electron'
       * @return {Command} `this` command for chaining
       */
      parse(argv, parseOptions) {
        const userArgs = this._prepareUserArgs(argv, parseOptions);
        this._parseCommand([], userArgs);
        return this;
      }
      /**
       * Parse `argv`, setting options and invoking commands when defined.
       *
       * Call with no parameters to parse `process.argv`. Detects Electron and special node options like `node --eval`. Easy mode!
       *
       * Or call with an array of strings to parse, and optionally where the user arguments start by specifying where the arguments are `from`:
       * - `'node'`: default, `argv[0]` is the application and `argv[1]` is the script being run, with user arguments after that
       * - `'electron'`: `argv[0]` is the application and `argv[1]` varies depending on whether the electron application is packaged
       * - `'user'`: just user arguments
       *
       * @example
       * await program.parseAsync(); // parse process.argv and auto-detect electron and special node flags
       * await program.parseAsync(process.argv); // assume argv[0] is app and argv[1] is script
       * await program.parseAsync(my-args, { from: 'user' }); // just user supplied arguments, nothing special about argv[0]
       *
       * @param {string[]} [argv]
       * @param {object} [parseOptions]
       * @param {string} parseOptions.from - where the args are from: 'node', 'user', 'electron'
       * @return {Promise}
       */
      async parseAsync(argv, parseOptions) {
        const userArgs = this._prepareUserArgs(argv, parseOptions);
        await this._parseCommand([], userArgs);
        return this;
      }
      /**
       * Execute a sub-command executable.
       *
       * @private
       */
      _executeSubCommand(subcommand, args) {
        args = args.slice();
        let launchWithNode = false;
        const sourceExt = [".js", ".ts", ".tsx", ".mjs", ".cjs"];
        function findFile(baseDir, baseName) {
          const localBin = path.resolve(baseDir, baseName);
          if (fs.existsSync(localBin)) return localBin;
          if (sourceExt.includes(path.extname(baseName))) return void 0;
          const foundExt = sourceExt.find(
            (ext) => fs.existsSync(`${localBin}${ext}`)
          );
          if (foundExt) return `${localBin}${foundExt}`;
          return void 0;
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
          executableDir = path.resolve(
            path.dirname(resolvedScriptPath),
            executableDir
          );
        }
        if (executableDir) {
          let localFile = findFile(executableDir, executableFile);
          if (!localFile && !subcommand._executableFile && this._scriptPath) {
            const legacyName = path.basename(
              this._scriptPath,
              path.extname(this._scriptPath)
            );
            if (legacyName !== this._name) {
              localFile = findFile(
                executableDir,
                `${legacyName}-${subcommand._name}`
              );
            }
          }
          executableFile = localFile || executableFile;
        }
        launchWithNode = sourceExt.includes(path.extname(executableFile));
        let proc;
        if (process10.platform !== "win32") {
          if (launchWithNode) {
            args.unshift(executableFile);
            args = incrementNodeInspectorPort(process10.execArgv).concat(args);
            proc = childProcess.spawn(process10.argv[0], args, { stdio: "inherit" });
          } else {
            proc = childProcess.spawn(executableFile, args, { stdio: "inherit" });
          }
        } else {
          args.unshift(executableFile);
          args = incrementNodeInspectorPort(process10.execArgv).concat(args);
          proc = childProcess.spawn(process10.execPath, args, { stdio: "inherit" });
        }
        if (!proc.killed) {
          const signals2 = ["SIGUSR1", "SIGUSR2", "SIGTERM", "SIGINT", "SIGHUP"];
          signals2.forEach((signal) => {
            process10.on(signal, () => {
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
            process10.exit(code);
          } else {
            exitCallback(
              new CommanderError2(
                code,
                "commander.executeSubCommandAsync",
                "(close)"
              )
            );
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
            process10.exit(1);
          } else {
            const wrappedError = new CommanderError2(
              1,
              "commander.executeSubCommandAsync",
              "(error)"
            );
            wrappedError.nestedError = err;
            exitCallback(wrappedError);
          }
        });
        this.runningCommand = proc;
      }
      /**
       * @private
       */
      _dispatchSubcommand(commandName, operands, unknown) {
        const subCommand = this._findCommand(commandName);
        if (!subCommand) this.help({ error: true });
        let promiseChain;
        promiseChain = this._chainOrCallSubCommandHook(
          promiseChain,
          subCommand,
          "preSubcommand"
        );
        promiseChain = this._chainOrCall(promiseChain, () => {
          if (subCommand._executableHandler) {
            this._executeSubCommand(subCommand, operands.concat(unknown));
          } else {
            return subCommand._parseCommand(operands, unknown);
          }
        });
        return promiseChain;
      }
      /**
       * Invoke help directly if possible, or dispatch if necessary.
       * e.g. help foo
       *
       * @private
       */
      _dispatchHelpCommand(subcommandName) {
        if (!subcommandName) {
          this.help();
        }
        const subCommand = this._findCommand(subcommandName);
        if (subCommand && !subCommand._executableHandler) {
          subCommand.help();
        }
        return this._dispatchSubcommand(
          subcommandName,
          [],
          [this._getHelpOption()?.long ?? this._getHelpOption()?.short ?? "--help"]
        );
      }
      /**
       * Check this.args against expected this.registeredArguments.
       *
       * @private
       */
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
      /**
       * Process this.args using this.registeredArguments and save as this.processedArgs!
       *
       * @private
       */
      _processArguments() {
        const myParseArg = (argument, value, previous) => {
          let parsedValue = value;
          if (value !== null && argument.parseArg) {
            const invalidValueMessage = `error: command-argument value '${value}' is invalid for argument '${argument.name()}'.`;
            parsedValue = this._callParseArg(
              argument,
              value,
              previous,
              invalidValueMessage
            );
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
            } else if (value === void 0) {
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
      /**
       * Once we have a promise we chain, but call synchronously until then.
       *
       * @param {(Promise|undefined)} promise
       * @param {Function} fn
       * @return {(Promise|undefined)}
       * @private
       */
      _chainOrCall(promise, fn) {
        if (promise && promise.then && typeof promise.then === "function") {
          return promise.then(() => fn());
        }
        return fn();
      }
      /**
       *
       * @param {(Promise|undefined)} promise
       * @param {string} event
       * @return {(Promise|undefined)}
       * @private
       */
      _chainOrCallHooks(promise, event) {
        let result = promise;
        const hooks = [];
        this._getCommandAndAncestors().reverse().filter((cmd) => cmd._lifeCycleHooks[event] !== void 0).forEach((hookedCommand) => {
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
      /**
       *
       * @param {(Promise|undefined)} promise
       * @param {Command} subCommand
       * @param {string} event
       * @return {(Promise|undefined)}
       * @private
       */
      _chainOrCallSubCommandHook(promise, subCommand, event) {
        let result = promise;
        if (this._lifeCycleHooks[event] !== void 0) {
          this._lifeCycleHooks[event].forEach((hook) => {
            result = this._chainOrCall(result, () => {
              return hook(this, subCommand);
            });
          });
        }
        return result;
      }
      /**
       * Process arguments in context of this command.
       * Returns action result, in case it is a promise.
       *
       * @private
       */
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
          return this._dispatchSubcommand(
            this._defaultCommandName,
            operands,
            unknown
          );
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
          promiseChain = this._chainOrCall(
            promiseChain,
            () => this._actionHandler(this.processedArgs)
          );
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
      /**
       * Find matching command.
       *
       * @private
       * @return {Command | undefined}
       */
      _findCommand(name) {
        if (!name) return void 0;
        return this.commands.find(
          (cmd) => cmd._name === name || cmd._aliases.includes(name)
        );
      }
      /**
       * Return an option matching `arg` if any.
       *
       * @param {string} arg
       * @return {Option}
       * @package
       */
      _findOption(arg) {
        return this.options.find((option) => option.is(arg));
      }
      /**
       * Display an error message if a mandatory option does not have a value.
       * Called after checking for help flags in leaf subcommand.
       *
       * @private
       */
      _checkForMissingMandatoryOptions() {
        this._getCommandAndAncestors().forEach((cmd) => {
          cmd.options.forEach((anOption) => {
            if (anOption.mandatory && cmd.getOptionValue(anOption.attributeName()) === void 0) {
              cmd.missingMandatoryOptionValue(anOption);
            }
          });
        });
      }
      /**
       * Display an error message if conflicting options are used together in this.
       *
       * @private
       */
      _checkForConflictingLocalOptions() {
        const definedNonDefaultOptions = this.options.filter((option) => {
          const optionKey = option.attributeName();
          if (this.getOptionValue(optionKey) === void 0) {
            return false;
          }
          return this.getOptionValueSource(optionKey) !== "default";
        });
        const optionsWithConflicting = definedNonDefaultOptions.filter(
          (option) => option.conflictsWith.length > 0
        );
        optionsWithConflicting.forEach((option) => {
          const conflictingAndDefined = definedNonDefaultOptions.find(
            (defined) => option.conflictsWith.includes(defined.attributeName())
          );
          if (conflictingAndDefined) {
            this._conflictingOption(option, conflictingAndDefined);
          }
        });
      }
      /**
       * Display an error message if conflicting options are used together.
       * Called after checking for help flags in leaf subcommand.
       *
       * @private
       */
      _checkForConflictingOptions() {
        this._getCommandAndAncestors().forEach((cmd) => {
          cmd._checkForConflictingLocalOptions();
        });
      }
      /**
       * Parse options from `argv` removing known options,
       * and return argv split into operands and unknown arguments.
       *
       * Examples:
       *
       *     argv => operands, unknown
       *     --known kkk op => [op], []
       *     op --known kkk => [op], []
       *     sub --unknown uuu op => [sub], [--unknown uuu op]
       *     sub -- --unknown uuu op => [sub --unknown uuu op], []
       *
       * @param {string[]} argv
       * @return {{operands: string[], unknown: string[]}}
       */
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
            if (dest === unknown) dest.push(arg);
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
                if (value === void 0) this.optionMissingArgument(option);
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
              if (args.length > 0) unknown.push(...args);
              break;
            } else if (this._getHelpCommand() && arg === this._getHelpCommand().name()) {
              operands.push(arg);
              if (args.length > 0) operands.push(...args);
              break;
            } else if (this._defaultCommandName) {
              unknown.push(arg);
              if (args.length > 0) unknown.push(...args);
              break;
            }
          }
          if (this._passThroughOptions) {
            dest.push(arg);
            if (args.length > 0) dest.push(...args);
            break;
          }
          dest.push(arg);
        }
        return { operands, unknown };
      }
      /**
       * Return an object containing local option values as key-value pairs.
       *
       * @return {object}
       */
      opts() {
        if (this._storeOptionsAsProperties) {
          const result = {};
          const len = this.options.length;
          for (let i = 0; i < len; i++) {
            const key = this.options[i].attributeName();
            result[key] = key === this._versionOptionName ? this._version : this[key];
          }
          return result;
        }
        return this._optionValues;
      }
      /**
       * Return an object containing merged local and global option values as key-value pairs.
       *
       * @return {object}
       */
      optsWithGlobals() {
        return this._getCommandAndAncestors().reduce(
          (combinedOptions, cmd) => Object.assign(combinedOptions, cmd.opts()),
          {}
        );
      }
      /**
       * Display error message and exit (or call exitOverride).
       *
       * @param {string} message
       * @param {object} [errorOptions]
       * @param {string} [errorOptions.code] - an id string representing the error
       * @param {number} [errorOptions.exitCode] - used with process.exit
       */
      error(message, errorOptions) {
        this._outputConfiguration.outputError(
          `${message}
`,
          this._outputConfiguration.writeErr
        );
        if (typeof this._showHelpAfterError === "string") {
          this._outputConfiguration.writeErr(`${this._showHelpAfterError}
`);
        } else if (this._showHelpAfterError) {
          this._outputConfiguration.writeErr("\n");
          this.outputHelp({ error: true });
        }
        const config = errorOptions || {};
        const exitCode = config.exitCode || 1;
        const code = config.code || "commander.error";
        this._exit(exitCode, code, message);
      }
      /**
       * Apply any option related environment variables, if option does
       * not have a value from cli or client code.
       *
       * @private
       */
      _parseOptionsEnv() {
        this.options.forEach((option) => {
          if (option.envVar && option.envVar in process10.env) {
            const optionKey = option.attributeName();
            if (this.getOptionValue(optionKey) === void 0 || ["default", "config", "env"].includes(
              this.getOptionValueSource(optionKey)
            )) {
              if (option.required || option.optional) {
                this.emit(`optionEnv:${option.name()}`, process10.env[option.envVar]);
              } else {
                this.emit(`optionEnv:${option.name()}`);
              }
            }
          }
        });
      }
      /**
       * Apply any implied option values, if option is undefined or default value.
       *
       * @private
       */
      _parseOptionsImplied() {
        const dualHelper = new DualOptions(this.options);
        const hasCustomOptionValue = (optionKey) => {
          return this.getOptionValue(optionKey) !== void 0 && !["default", "implied"].includes(this.getOptionValueSource(optionKey));
        };
        this.options.filter(
          (option) => option.implied !== void 0 && hasCustomOptionValue(option.attributeName()) && dualHelper.valueFromOption(
            this.getOptionValue(option.attributeName()),
            option
          )
        ).forEach((option) => {
          Object.keys(option.implied).filter((impliedKey) => !hasCustomOptionValue(impliedKey)).forEach((impliedKey) => {
            this.setOptionValueWithSource(
              impliedKey,
              option.implied[impliedKey],
              "implied"
            );
          });
        });
      }
      /**
       * Argument `name` is missing.
       *
       * @param {string} name
       * @private
       */
      missingArgument(name) {
        const message = `error: missing required argument '${name}'`;
        this.error(message, { code: "commander.missingArgument" });
      }
      /**
       * `Option` is missing an argument.
       *
       * @param {Option} option
       * @private
       */
      optionMissingArgument(option) {
        const message = `error: option '${option.flags}' argument missing`;
        this.error(message, { code: "commander.optionMissingArgument" });
      }
      /**
       * `Option` does not have a value, and is a mandatory option.
       *
       * @param {Option} option
       * @private
       */
      missingMandatoryOptionValue(option) {
        const message = `error: required option '${option.flags}' not specified`;
        this.error(message, { code: "commander.missingMandatoryOptionValue" });
      }
      /**
       * `Option` conflicts with another option.
       *
       * @param {Option} option
       * @param {Option} conflictingOption
       * @private
       */
      _conflictingOption(option, conflictingOption) {
        const findBestOptionFromValue = (option2) => {
          const optionKey = option2.attributeName();
          const optionValue = this.getOptionValue(optionKey);
          const negativeOption = this.options.find(
            (target) => target.negate && optionKey === target.attributeName()
          );
          const positiveOption = this.options.find(
            (target) => !target.negate && optionKey === target.attributeName()
          );
          if (negativeOption && (negativeOption.presetArg === void 0 && optionValue === false || negativeOption.presetArg !== void 0 && optionValue === negativeOption.presetArg)) {
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
      /**
       * Unknown option `flag`.
       *
       * @param {string} flag
       * @private
       */
      unknownOption(flag) {
        if (this._allowUnknownOption) return;
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
      /**
       * Excess arguments, more than expected.
       *
       * @param {string[]} receivedArgs
       * @private
       */
      _excessArguments(receivedArgs) {
        if (this._allowExcessArguments) return;
        const expected = this.registeredArguments.length;
        const s = expected === 1 ? "" : "s";
        const forSubcommand = this.parent ? ` for '${this.name()}'` : "";
        const message = `error: too many arguments${forSubcommand}. Expected ${expected} argument${s} but got ${receivedArgs.length}.`;
        this.error(message, { code: "commander.excessArguments" });
      }
      /**
       * Unknown command.
       *
       * @private
       */
      unknownCommand() {
        const unknownName = this.args[0];
        let suggestion = "";
        if (this._showSuggestionAfterError) {
          const candidateNames = [];
          this.createHelp().visibleCommands(this).forEach((command) => {
            candidateNames.push(command.name());
            if (command.alias()) candidateNames.push(command.alias());
          });
          suggestion = suggestSimilar(unknownName, candidateNames);
        }
        const message = `error: unknown command '${unknownName}'${suggestion}`;
        this.error(message, { code: "commander.unknownCommand" });
      }
      /**
       * Get or set the program version.
       *
       * This method auto-registers the "-V, --version" option which will print the version number.
       *
       * You can optionally supply the flags and description to override the defaults.
       *
       * @param {string} [str]
       * @param {string} [flags]
       * @param {string} [description]
       * @return {(this | string | undefined)} `this` command for chaining, or version string if no arguments
       */
      version(str, flags, description) {
        if (str === void 0) return this._version;
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
      /**
       * Set the description.
       *
       * @param {string} [str]
       * @param {object} [argsDescription]
       * @return {(string|Command)}
       */
      description(str, argsDescription) {
        if (str === void 0 && argsDescription === void 0)
          return this._description;
        this._description = str;
        if (argsDescription) {
          this._argsDescription = argsDescription;
        }
        return this;
      }
      /**
       * Set the summary. Used when listed as subcommand of parent.
       *
       * @param {string} [str]
       * @return {(string|Command)}
       */
      summary(str) {
        if (str === void 0) return this._summary;
        this._summary = str;
        return this;
      }
      /**
       * Set an alias for the command.
       *
       * You may call more than once to add multiple aliases. Only the first alias is shown in the auto-generated help.
       *
       * @param {string} [alias]
       * @return {(string|Command)}
       */
      alias(alias) {
        if (alias === void 0) return this._aliases[0];
        let command = this;
        if (this.commands.length !== 0 && this.commands[this.commands.length - 1]._executableHandler) {
          command = this.commands[this.commands.length - 1];
        }
        if (alias === command._name)
          throw new Error("Command alias can't be the same as its name");
        const matchingCommand = this.parent?._findCommand(alias);
        if (matchingCommand) {
          const existingCmd = [matchingCommand.name()].concat(matchingCommand.aliases()).join("|");
          throw new Error(
            `cannot add alias '${alias}' to command '${this.name()}' as already have command '${existingCmd}'`
          );
        }
        command._aliases.push(alias);
        return this;
      }
      /**
       * Set aliases for the command.
       *
       * Only the first alias is shown in the auto-generated help.
       *
       * @param {string[]} [aliases]
       * @return {(string[]|Command)}
       */
      aliases(aliases) {
        if (aliases === void 0) return this._aliases;
        aliases.forEach((alias) => this.alias(alias));
        return this;
      }
      /**
       * Set / get the command usage `str`.
       *
       * @param {string} [str]
       * @return {(string|Command)}
       */
      usage(str) {
        if (str === void 0) {
          if (this._usage) return this._usage;
          const args = this.registeredArguments.map((arg) => {
            return humanReadableArgName(arg);
          });
          return [].concat(
            this.options.length || this._helpOption !== null ? "[options]" : [],
            this.commands.length ? "[command]" : [],
            this.registeredArguments.length ? args : []
          ).join(" ");
        }
        this._usage = str;
        return this;
      }
      /**
       * Get or set the name of the command.
       *
       * @param {string} [str]
       * @return {(string|Command)}
       */
      name(str) {
        if (str === void 0) return this._name;
        this._name = str;
        return this;
      }
      /**
       * Set the name of the command from script filename, such as process.argv[1],
       * or require.main.filename, or __filename.
       *
       * (Used internally and public although not documented in README.)
       *
       * @example
       * program.nameFromFilename(require.main.filename);
       *
       * @param {string} filename
       * @return {Command}
       */
      nameFromFilename(filename) {
        this._name = path.basename(filename, path.extname(filename));
        return this;
      }
      /**
       * Get or set the directory for searching for executable subcommands of this command.
       *
       * @example
       * program.executableDir(__dirname);
       * // or
       * program.executableDir('subcommands');
       *
       * @param {string} [path]
       * @return {(string|null|Command)}
       */
      executableDir(path2) {
        if (path2 === void 0) return this._executableDir;
        this._executableDir = path2;
        return this;
      }
      /**
       * Return program help documentation.
       *
       * @param {{ error: boolean }} [contextOptions] - pass {error:true} to wrap for stderr instead of stdout
       * @return {string}
       */
      helpInformation(contextOptions) {
        const helper = this.createHelp();
        if (helper.helpWidth === void 0) {
          helper.helpWidth = contextOptions && contextOptions.error ? this._outputConfiguration.getErrHelpWidth() : this._outputConfiguration.getOutHelpWidth();
        }
        return helper.formatHelp(this, helper);
      }
      /**
       * @private
       */
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
      /**
       * Output help information for this command.
       *
       * Outputs built-in help, and custom text added using `.addHelpText()`.
       *
       * @param {{ error: boolean } | Function} [contextOptions] - pass {error:true} to write to stderr instead of stdout
       */
      outputHelp(contextOptions) {
        let deprecatedCallback;
        if (typeof contextOptions === "function") {
          deprecatedCallback = contextOptions;
          contextOptions = void 0;
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
        this._getCommandAndAncestors().forEach(
          (command) => command.emit("afterAllHelp", context)
        );
      }
      /**
       * You can pass in flags and a description to customise the built-in help option.
       * Pass in false to disable the built-in help option.
       *
       * @example
       * program.helpOption('-?, --help' 'show help'); // customise
       * program.helpOption(false); // disable
       *
       * @param {(string | boolean)} flags
       * @param {string} [description]
       * @return {Command} `this` command for chaining
       */
      helpOption(flags, description) {
        if (typeof flags === "boolean") {
          if (flags) {
            this._helpOption = this._helpOption ?? void 0;
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
      /**
       * Lazy create help option.
       * Returns null if has been disabled with .helpOption(false).
       *
       * @returns {(Option | null)} the help option
       * @package
       */
      _getHelpOption() {
        if (this._helpOption === void 0) {
          this.helpOption(void 0, void 0);
        }
        return this._helpOption;
      }
      /**
       * Supply your own option to use for the built-in help option.
       * This is an alternative to using helpOption() to customise the flags and description etc.
       *
       * @param {Option} option
       * @return {Command} `this` command for chaining
       */
      addHelpOption(option) {
        this._helpOption = option;
        return this;
      }
      /**
       * Output help information and exit.
       *
       * Outputs built-in help, and custom text added using `.addHelpText()`.
       *
       * @param {{ error: boolean }} [contextOptions] - pass {error:true} to write to stderr instead of stdout
       */
      help(contextOptions) {
        this.outputHelp(contextOptions);
        let exitCode = process10.exitCode || 0;
        if (exitCode === 0 && contextOptions && typeof contextOptions !== "function" && contextOptions.error) {
          exitCode = 1;
        }
        this._exit(exitCode, "commander.help", "(outputHelp)");
      }
      /**
       * Add additional text to be displayed with the built-in help.
       *
       * Position is 'before' or 'after' to affect just this command,
       * and 'beforeAll' or 'afterAll' to affect this command and all its subcommands.
       *
       * @param {string} position - before or after built-in help
       * @param {(string | Function)} text - string to add, or a function returning a string
       * @return {Command} `this` command for chaining
       */
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
      /**
       * Output help information if help flags specified
       *
       * @param {Array} args - array of options to search for help flags
       * @private
       */
      _outputHelpIfRequested(args) {
        const helpOption = this._getHelpOption();
        const helpRequested = helpOption && args.find((arg) => helpOption.is(arg));
        if (helpRequested) {
          this.outputHelp();
          this._exit(0, "commander.helpDisplayed", "(outputHelp)");
        }
      }
    };
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
    exports.Command = Command2;
  }
});

// node_modules/commander/index.js
var require_commander = __commonJS({
  "node_modules/commander/index.js"(exports) {
    "use strict";
    var { Argument: Argument2 } = require_argument();
    var { Command: Command2 } = require_command();
    var { CommanderError: CommanderError2, InvalidArgumentError: InvalidArgumentError2 } = require_error();
    var { Help: Help2 } = require_help();
    var { Option: Option2 } = require_option();
    exports.program = new Command2();
    exports.createCommand = (name) => new Command2(name);
    exports.createOption = (flags, description) => new Option2(flags, description);
    exports.createArgument = (name, description) => new Argument2(name, description);
    exports.Command = Command2;
    exports.Option = Option2;
    exports.Argument = Argument2;
    exports.Help = Help2;
    exports.CommanderError = CommanderError2;
    exports.InvalidArgumentError = InvalidArgumentError2;
    exports.InvalidOptionArgumentError = InvalidArgumentError2;
  }
});

// src/relay.ts
var relay_exports = {};
__export(relay_exports, {
  DEFAULT_BACKEND: () => DEFAULT_BACKEND,
  DEFAULT_SANDBOX: () => DEFAULT_SANDBOX,
  DEFAULT_TIMEOUT_SECONDS: () => DEFAULT_TIMEOUT_SECONDS,
  MAX_CONTEXT_FILE_BYTES: () => MAX_CONTEXT_FILE_BYTES,
  MAX_DIFF_BYTES: () => MAX_DIFF_BYTES,
  MAX_PROMPT_BYTES: () => MAX_PROMPT_BYTES,
  MAX_RELAY_DEPTH: () => MAX_RELAY_DEPTH,
  RelayError: () => RelayError,
  relay: () => relay
});
import { execFileSync as execFileSync4 } from "child_process";
import { readFileSync as readFileSync2, existsSync as existsSync2, statSync } from "fs";
import { resolve } from "path";
function sizeBytes(text) {
  return Buffer.byteLength(text, "utf-8");
}
function ensureSizeLimit(label, text, maxBytes) {
  const size = sizeBytes(text);
  if (size > maxBytes) {
    throw new RelayError(`${label} is too large (${size} bytes; max ${maxBytes} bytes)`);
  }
}
function readContextFile(contextFile) {
  if (contextFile === null) return "";
  const resolved = resolve(contextFile);
  if (!existsSync2(resolved)) {
    throw new RelayError(`Context file does not exist: ${resolved}`);
  }
  const stat = statSync(resolved);
  if (!stat.isFile()) {
    throw new RelayError(`Context path is not a file: ${resolved}`);
  }
  try {
    const contents = readFileSync2(resolved, "utf-8").trim();
    ensureSizeLimit("Context file", contents, MAX_CONTEXT_FILE_BYTES);
    return contents;
  } catch (err) {
    if (err instanceof RelayError) throw err;
    throw new RelayError(`Failed reading context file: ${err}`);
  }
}
function resolveContextText(contextFile, contextText) {
  const fileText = readContextFile(contextFile);
  const inlineText = (contextText ?? "").trim();
  if (contextFile !== null && inlineText) {
    throw new RelayError("Use either context_file or context_text, not both");
  }
  if (inlineText) {
    ensureSizeLimit("Context text", inlineText, MAX_CONTEXT_FILE_BYTES);
    return inlineText;
  }
  return fileText;
}
function gitDiff(repoPath) {
  try {
    const result = execFileSync4("git", ["-C", repoPath, "diff", "--"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    });
    const diffText = result.trim();
    ensureSizeLimit("Git diff", diffText, MAX_DIFF_BYTES);
    return diffText;
  } catch (err) {
    if (err instanceof RelayError) throw err;
    const execErr = err;
    const detail = execErr.stderr?.toString().trim() || execErr.stdout?.toString().trim() || "git diff failed";
    throw new RelayError(`Failed to collect git diff: ${detail}`);
  }
}
function buildPrompt(opts) {
  const sections = [
    "You are helping another coding agent by reviewing or advising on work in a local repository.",
    `Repository path: ${opts.repoPath}`,
    "Use the repository files for context when needed.",
    "Respond with concise, actionable feedback.",
    "",
    "Request:",
    opts.prompt.trim()
  ];
  if (opts.contextText) {
    sections.push("", "Additional Context:", opts.contextText);
  }
  if (opts.diffText) {
    sections.push("", "Git Diff:", opts.diffText);
  }
  return sections.join("\n").trim();
}
function nextRelayEnv() {
  const depthRaw = process.env.PHONE_A_FRIEND_DEPTH ?? "0";
  const depth = /^\d+$/.test(depthRaw) ? Number(depthRaw) : 0;
  if (depth >= MAX_RELAY_DEPTH) {
    throw new RelayError("Relay depth limit reached; refusing nested relay invocation");
  }
  const env2 = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== void 0) env2[key] = value;
  }
  env2.PHONE_A_FRIEND_DEPTH = String(depth + 1);
  return env2;
}
function relay(opts) {
  const {
    prompt,
    repoPath,
    backend = DEFAULT_BACKEND,
    contextFile = null,
    contextText = null,
    includeDiff = false,
    timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
    model = null,
    sandbox = DEFAULT_SANDBOX
  } = opts;
  if (!prompt.trim()) {
    throw new RelayError("Prompt is required");
  }
  if (timeoutSeconds <= 0) {
    throw new RelayError("Timeout must be greater than zero");
  }
  const resolvedRepo = resolve(repoPath);
  if (!existsSync2(resolvedRepo) || !statSync(resolvedRepo).isDirectory()) {
    throw new RelayError(
      `Repository path does not exist or is not a directory: ${resolvedRepo}`
    );
  }
  let selectedBackend;
  try {
    selectedBackend = getBackend(backend);
  } catch (err) {
    throw new RelayError(String(err.message));
  }
  if (!selectedBackend.allowedSandboxes.has(sandbox)) {
    const allowed = [...selectedBackend.allowedSandboxes].sort().join(", ");
    throw new RelayError(`Invalid sandbox mode: ${sandbox}. Allowed values: ${allowed}`);
  }
  const resolvedContext = resolveContextText(contextFile, contextText);
  const diffText = includeDiff ? gitDiff(resolvedRepo) : "";
  const fullPrompt = buildPrompt({
    prompt,
    repoPath: resolvedRepo,
    contextText: resolvedContext,
    diffText
  });
  ensureSizeLimit("Relay prompt", fullPrompt, MAX_PROMPT_BYTES);
  const env2 = nextRelayEnv();
  try {
    return selectedBackend.run({
      prompt: fullPrompt,
      repoPath: resolvedRepo,
      timeoutSeconds,
      sandbox,
      model,
      env: env2
    });
  } catch (err) {
    if (err instanceof RelayError) throw err;
    if (err instanceof BackendError) {
      throw new RelayError(err.message);
    }
    throw err;
  }
}
var DEFAULT_TIMEOUT_SECONDS, DEFAULT_BACKEND, DEFAULT_SANDBOX, MAX_RELAY_DEPTH, MAX_CONTEXT_FILE_BYTES, MAX_DIFF_BYTES, MAX_PROMPT_BYTES, RelayError;
var init_relay = __esm({
  "src/relay.ts"() {
    "use strict";
    init_backends();
    DEFAULT_TIMEOUT_SECONDS = 600;
    DEFAULT_BACKEND = "codex";
    DEFAULT_SANDBOX = "read-only";
    MAX_RELAY_DEPTH = 1;
    MAX_CONTEXT_FILE_BYTES = 2e5;
    MAX_DIFF_BYTES = 3e5;
    MAX_PROMPT_BYTES = 5e5;
    RelayError = class extends Error {
      constructor(message) {
        super(message);
        this.name = "RelayError";
      }
    };
  }
});

// node_modules/cli-width/index.js
var require_cli_width = __commonJS({
  "node_modules/cli-width/index.js"(exports, module) {
    "use strict";
    module.exports = cliWidth2;
    function normalizeOpts(options) {
      const defaultOpts = {
        defaultWidth: 0,
        output: process.stdout,
        tty: __require("tty")
      };
      if (!options) {
        return defaultOpts;
      }
      Object.keys(defaultOpts).forEach(function(key) {
        if (!options[key]) {
          options[key] = defaultOpts[key];
        }
      });
      return options;
    }
    function cliWidth2(options) {
      const opts = normalizeOpts(options);
      if (opts.output.getWindowSize) {
        return opts.output.getWindowSize()[0] || opts.defaultWidth;
      }
      if (opts.tty.getWindowSize) {
        return opts.tty.getWindowSize()[1] || opts.defaultWidth;
      }
      if (opts.output.columns) {
        return opts.output.columns;
      }
      if (process.env.CLI_WIDTH) {
        const width = parseInt(process.env.CLI_WIDTH, 10);
        if (!isNaN(width) && width !== 0) {
          return width;
        }
      }
      return opts.defaultWidth;
    }
  }
});

// node_modules/mute-stream/lib/index.js
var require_lib = __commonJS({
  "node_modules/mute-stream/lib/index.js"(exports, module) {
    "use strict";
    var Stream = __require("stream");
    var MuteStream2 = class extends Stream {
      #isTTY = null;
      constructor(opts = {}) {
        super(opts);
        this.writable = this.readable = true;
        this.muted = false;
        this.on("pipe", this._onpipe);
        this.replace = opts.replace;
        this._prompt = opts.prompt || null;
        this._hadControl = false;
      }
      #destSrc(key, def) {
        if (this._dest) {
          return this._dest[key];
        }
        if (this._src) {
          return this._src[key];
        }
        return def;
      }
      #proxy(method, ...args) {
        if (typeof this._dest?.[method] === "function") {
          this._dest[method](...args);
        }
        if (typeof this._src?.[method] === "function") {
          this._src[method](...args);
        }
      }
      get isTTY() {
        if (this.#isTTY !== null) {
          return this.#isTTY;
        }
        return this.#destSrc("isTTY", false);
      }
      // basically just get replace the getter/setter with a regular value
      set isTTY(val) {
        this.#isTTY = val;
      }
      get rows() {
        return this.#destSrc("rows");
      }
      get columns() {
        return this.#destSrc("columns");
      }
      mute() {
        this.muted = true;
      }
      unmute() {
        this.muted = false;
      }
      _onpipe(src) {
        this._src = src;
      }
      pipe(dest, options) {
        this._dest = dest;
        return super.pipe(dest, options);
      }
      pause() {
        if (this._src) {
          return this._src.pause();
        }
      }
      resume() {
        if (this._src) {
          return this._src.resume();
        }
      }
      write(c) {
        if (this.muted) {
          if (!this.replace) {
            return true;
          }
          if (c.match(/^\u001b/)) {
            if (c.indexOf(this._prompt) === 0) {
              c = c.slice(this._prompt.length);
              c = c.replace(/./g, this.replace);
              c = this._prompt + c;
            }
            this._hadControl = true;
            return this.emit("data", c);
          } else {
            if (this._prompt && this._hadControl && c.indexOf(this._prompt) === 0) {
              this._hadControl = false;
              this.emit("data", this._prompt);
              c = c.slice(this._prompt.length);
            }
            c = c.toString().replace(/./g, this.replace);
          }
        }
        this.emit("data", c);
      }
      end(c) {
        if (this.muted) {
          if (c && this.replace) {
            c = c.toString().replace(/./g, this.replace);
          } else {
            c = null;
          }
        }
        if (c) {
          this.emit("data", c);
        }
        this.emit("end");
      }
      destroy(...args) {
        return this.#proxy("destroy", ...args);
      }
      destroySoon(...args) {
        return this.#proxy("destroySoon", ...args);
      }
      close(...args) {
        return this.#proxy("close", ...args);
      }
    };
    module.exports = MuteStream2;
  }
});

// src/backends/codex.ts
init_backends();
import { execFileSync as execFileSync2 } from "child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
var CodexBackendError = class extends BackendError {
  constructor(message) {
    super(message);
    this.name = "CodexBackendError";
  }
};
var CodexBackend = class {
  name = "codex";
  allowedSandboxes = /* @__PURE__ */ new Set([
    "read-only",
    "workspace-write",
    "danger-full-access"
  ]);
  run(opts) {
    if (!isInPath("codex")) {
      throw new CodexBackendError(
        `codex CLI not found in PATH. Install it: ${INSTALL_HINTS.codex}`
      );
    }
    const tmpDir = mkdtempSync(join(tmpdir(), "phone-a-friend-"));
    const outputPath = join(tmpDir, "codex-last-message.txt");
    try {
      const args = [
        "exec",
        "-C",
        opts.repoPath,
        "--skip-git-repo-check",
        "--sandbox",
        opts.sandbox,
        "--output-last-message",
        outputPath
      ];
      if (opts.model) {
        args.push("-m", opts.model);
      }
      args.push(opts.prompt);
      let stdout = "";
      try {
        const result = execFileSync2("codex", args, {
          timeout: opts.timeoutSeconds * 1e3,
          env: opts.env,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"]
        });
        stdout = result.trim();
      } catch (err) {
        const execErr = err;
        if (execErr.killed || execErr.signal === "SIGTERM" || execErr.code === "ETIMEDOUT") {
          throw new CodexBackendError(
            `codex exec timed out after ${opts.timeoutSeconds}s`
          );
        }
        const lastMessage2 = readOutputFile(outputPath);
        const stderr = execErr.stderr?.toString().trim() ?? "";
        const stdoutStr = execErr.stdout?.toString().trim() ?? "";
        const detail = stderr || stdoutStr || lastMessage2 || `codex exec exited with code ${execErr.status ?? 1}`;
        throw new CodexBackendError(detail);
      }
      const lastMessage = readOutputFile(outputPath);
      if (lastMessage) {
        return lastMessage;
      }
      if (stdout) {
        return stdout;
      }
      throw new CodexBackendError("codex exec completed without producing feedback");
    } finally {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
      }
    }
  }
};
function readOutputFile(outputPath) {
  if (!existsSync(outputPath)) {
    return "";
  }
  try {
    return readFileSync(outputPath, "utf-8").trim();
  } catch (err) {
    throw new CodexBackendError(
      `Failed reading Codex output file: ${err}`
    );
  }
}
var CODEX_BACKEND = new CodexBackend();
registerBackend(CODEX_BACKEND);

// src/backends/gemini.ts
init_backends();
import { execFileSync as execFileSync3 } from "child_process";
var GeminiBackendError = class extends BackendError {
  constructor(message) {
    super(message);
    this.name = "GeminiBackendError";
  }
};
var GeminiBackend = class {
  name = "gemini";
  allowedSandboxes = /* @__PURE__ */ new Set([
    "read-only",
    "workspace-write",
    "danger-full-access"
  ]);
  run(opts) {
    if (!isInPath("gemini")) {
      throw new GeminiBackendError(
        `gemini CLI not found in PATH. Install it: ${INSTALL_HINTS.gemini}`
      );
    }
    const args = [];
    if (opts.sandbox !== "danger-full-access") {
      args.push("--sandbox");
    }
    args.push("--yolo");
    args.push("--include-directories", opts.repoPath);
    args.push("--output-format", "text");
    if (opts.model) {
      args.push("-m", opts.model);
    }
    args.push("--prompt", opts.prompt);
    try {
      const result = execFileSync3("gemini", args, {
        timeout: opts.timeoutSeconds * 1e3,
        env: opts.env,
        encoding: "utf-8",
        cwd: opts.repoPath,
        stdio: ["pipe", "pipe", "pipe"]
      });
      const output = result.trim();
      if (output) {
        return output;
      }
      throw new GeminiBackendError("gemini completed without producing output");
    } catch (err) {
      if (err instanceof GeminiBackendError) throw err;
      const execErr = err;
      if (execErr.killed || execErr.signal === "SIGTERM" || execErr.code === "ETIMEDOUT") {
        throw new GeminiBackendError(
          `gemini timed out after ${opts.timeoutSeconds}s`
        );
      }
      const stderr = execErr.stderr?.toString().trim() ?? "";
      const stdout = execErr.stdout?.toString().trim() ?? "";
      const detail = stderr || stdout || `gemini exited with code ${execErr.status ?? 1}`;
      throw new GeminiBackendError(detail);
    }
  }
};
var GEMINI_BACKEND = new GeminiBackend();
registerBackend(GEMINI_BACKEND);

// src/cli.ts
import { resolve as resolve4, dirname as dirname4 } from "path";
import { existsSync as existsSync5 } from "fs";
import { fileURLToPath as fileURLToPath2 } from "url";
import { spawnSync } from "child_process";

// node_modules/commander/esm.mjs
var import_index3 = __toESM(require_commander(), 1);
var {
  program,
  createCommand,
  createArgument,
  createOption,
  CommanderError,
  InvalidArgumentError,
  InvalidOptionArgumentError,
  // deprecated old name
  Command,
  Argument,
  Option,
  Help
} = import_index3.default;

// node_modules/ora/index.js
import process8 from "process";
import { stripVTControlCharacters } from "util";

// node_modules/chalk/source/vendor/ansi-styles/index.js
var ANSI_BACKGROUND_OFFSET = 10;
var wrapAnsi16 = (offset = 0) => (code) => `\x1B[${code + offset}m`;
var wrapAnsi256 = (offset = 0) => (code) => `\x1B[${38 + offset};5;${code}m`;
var wrapAnsi16m = (offset = 0) => (red2, green2, blue2) => `\x1B[${38 + offset};2;${red2};${green2};${blue2}m`;
var styles = {
  modifier: {
    reset: [0, 0],
    // 21 isn't widely supported and 22 does the same thing
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
    // Bright color
    blackBright: [90, 39],
    gray: [90, 39],
    // Alias of `blackBright`
    grey: [90, 39],
    // Alias of `blackBright`
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
    // Bright color
    bgBlackBright: [100, 49],
    bgGray: [100, 49],
    // Alias of `bgBlackBright`
    bgGrey: [100, 49],
    // Alias of `bgBlackBright`
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
  const codes = /* @__PURE__ */ new Map();
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
      value(red2, green2, blue2) {
        if (red2 === green2 && green2 === blue2) {
          if (red2 < 8) {
            return 16;
          }
          if (red2 > 248) {
            return 231;
          }
          return Math.round((red2 - 8) / 247 * 24) + 232;
        }
        return 16 + 36 * Math.round(red2 / 255 * 5) + 6 * Math.round(green2 / 255 * 5) + Math.round(blue2 / 255 * 5);
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
          /* eslint-disable no-bitwise */
          integer >> 16 & 255,
          integer >> 8 & 255,
          integer & 255
          /* eslint-enable no-bitwise */
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
        let red2;
        let green2;
        let blue2;
        if (code >= 232) {
          red2 = ((code - 232) * 10 + 8) / 255;
          green2 = red2;
          blue2 = red2;
        } else {
          code -= 16;
          const remainder = code % 36;
          red2 = Math.floor(code / 36) / 5;
          green2 = Math.floor(remainder / 6) / 5;
          blue2 = remainder % 6 / 5;
        }
        const value = Math.max(red2, green2, blue2) * 2;
        if (value === 0) {
          return 30;
        }
        let result = 30 + (Math.round(blue2) << 2 | Math.round(green2) << 1 | Math.round(red2));
        if (value === 2) {
          result += 60;
        }
        return result;
      },
      enumerable: false
    },
    rgbToAnsi: {
      value: (red2, green2, blue2) => styles.ansi256ToAnsi(styles.rgbToAnsi256(red2, green2, blue2)),
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

// node_modules/chalk/source/vendor/supports-color/index.js
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
  if (noFlagForceColor !== void 0) {
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
  if (haveStream && !streamIsTTY && forceColor === void 0) {
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
    if (["GITHUB_ACTIONS", "GITEA_ACTIONS", "CIRCLECI"].some((key) => key in env)) {
      return 3;
    }
    if (["TRAVIS", "APPVEYOR", "GITLAB_CI", "BUILDKITE", "DRONE"].some((sign) => sign in env) || env.CI_NAME === "codeship") {
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

// node_modules/chalk/source/utilities.js
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
    returnValue += string.slice(endIndex, gotCR ? index - 1 : index) + prefix + (gotCR ? "\r\n" : "\n") + postfix;
    endIndex = index + 1;
    index = string.indexOf("\n", endIndex);
  } while (index !== -1);
  returnValue += string.slice(endIndex);
  return returnValue;
}

// node_modules/chalk/source/index.js
var { stdout: stdoutColor, stderr: stderrColor } = supports_color_default;
var GENERATOR = /* @__PURE__ */ Symbol("GENERATOR");
var STYLER = /* @__PURE__ */ Symbol("STYLER");
var IS_EMPTY = /* @__PURE__ */ Symbol("IS_EMPTY");
var levelMapping = [
  "ansi",
  "ansi",
  "ansi256",
  "ansi16m"
];
var styles2 = /* @__PURE__ */ Object.create(null);
var applyOptions = (object, options = {}) => {
  if (options.level && !(Number.isInteger(options.level) && options.level >= 0 && options.level <= 3)) {
    throw new Error("The `level` option should be an integer from 0 to 3");
  }
  const colorLevel = stdoutColor ? stdoutColor.level : 0;
  object.level = options.level === void 0 ? colorLevel : options.level;
};
var chalkFactory = (options) => {
  const chalk2 = (...strings) => strings.join(" ");
  applyOptions(chalk2, options);
  Object.setPrototypeOf(chalk2, createChalk.prototype);
  return chalk2;
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
var proto = Object.defineProperties(() => {
}, {
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
  if (parent === void 0) {
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
  if (styler === void 0) {
    return string;
  }
  const { openAll, closeAll } = styler;
  if (string.includes("\x1B")) {
    while (styler !== void 0) {
      string = stringReplaceAll(string, styler.close, styler.open);
      styler = styler.parent;
    }
  }
  const lfIndex = string.indexOf("\n");
  if (lfIndex !== -1) {
    string = stringEncaseCRLFWithFirstIndex(string, closeAll, openAll, lfIndex);
  }
  return openAll + string + closeAll;
};
Object.defineProperties(createChalk.prototype, styles2);
var chalk = createChalk();
var chalkStderr = createChalk({ level: stderrColor ? stderrColor.level : 0 });
var source_default = chalk;

// node_modules/cli-cursor/index.js
import process5 from "process";

// node_modules/restore-cursor/index.js
import process4 from "process";

// node_modules/mimic-function/index.js
var copyProperty = (to, from, property, ignoreNonConfigurable) => {
  if (property === "length" || property === "prototype") {
    return;
  }
  if (property === "arguments" || property === "caller") {
    return;
  }
  const toDescriptor = Object.getOwnPropertyDescriptor(to, property);
  const fromDescriptor = Object.getOwnPropertyDescriptor(from, property);
  if (!canCopyProperty(toDescriptor, fromDescriptor) && ignoreNonConfigurable) {
    return;
  }
  Object.defineProperty(to, property, fromDescriptor);
};
var canCopyProperty = function(toDescriptor, fromDescriptor) {
  return toDescriptor === void 0 || toDescriptor.configurable || toDescriptor.writable === fromDescriptor.writable && toDescriptor.enumerable === fromDescriptor.enumerable && toDescriptor.configurable === fromDescriptor.configurable && (toDescriptor.writable || toDescriptor.value === fromDescriptor.value);
};
var changePrototype = (to, from) => {
  const fromPrototype = Object.getPrototypeOf(from);
  if (fromPrototype === Object.getPrototypeOf(to)) {
    return;
  }
  Object.setPrototypeOf(to, fromPrototype);
};
var wrappedToString = (withName, fromBody) => `/* Wrapped ${withName}*/
${fromBody}`;
var toStringDescriptor = Object.getOwnPropertyDescriptor(Function.prototype, "toString");
var toStringName = Object.getOwnPropertyDescriptor(Function.prototype.toString, "name");
var changeToString = (to, from, name) => {
  const withName = name === "" ? "" : `with ${name.trim()}() `;
  const newToString = wrappedToString.bind(null, withName, from.toString());
  Object.defineProperty(newToString, "name", toStringName);
  const { writable, enumerable, configurable } = toStringDescriptor;
  Object.defineProperty(to, "toString", { value: newToString, writable, enumerable, configurable });
};
function mimicFunction(to, from, { ignoreNonConfigurable = false } = {}) {
  const { name } = to;
  for (const property of Reflect.ownKeys(from)) {
    copyProperty(to, from, property, ignoreNonConfigurable);
  }
  changePrototype(to, from);
  changeToString(to, from, name);
  return to;
}

// node_modules/onetime/index.js
var calledFunctions = /* @__PURE__ */ new WeakMap();
var onetime = (function_, options = {}) => {
  if (typeof function_ !== "function") {
    throw new TypeError("Expected a function");
  }
  let returnValue;
  let callCount = 0;
  const functionName = function_.displayName || function_.name || "<anonymous>";
  const onetime2 = function(...arguments_) {
    calledFunctions.set(onetime2, ++callCount);
    if (callCount === 1) {
      returnValue = function_.apply(this, arguments_);
      function_ = void 0;
    } else if (options.throw === true) {
      throw new Error(`Function \`${functionName}\` can only be called once`);
    }
    return returnValue;
  };
  mimicFunction(onetime2, function_);
  calledFunctions.set(onetime2, callCount);
  return onetime2;
};
onetime.callCount = (function_) => {
  if (!calledFunctions.has(function_)) {
    throw new Error(`The given function \`${function_.name}\` is not wrapped by the \`onetime\` package`);
  }
  return calledFunctions.get(function_);
};
var onetime_default = onetime;

// node_modules/signal-exit/dist/mjs/signals.js
var signals = [];
signals.push("SIGHUP", "SIGINT", "SIGTERM");
if (process.platform !== "win32") {
  signals.push(
    "SIGALRM",
    "SIGABRT",
    "SIGVTALRM",
    "SIGXCPU",
    "SIGXFSZ",
    "SIGUSR2",
    "SIGTRAP",
    "SIGSYS",
    "SIGQUIT",
    "SIGIOT"
    // should detect profiler and enable/disable accordingly.
    // see #21
    // 'SIGPROF'
  );
}
if (process.platform === "linux") {
  signals.push("SIGIO", "SIGPOLL", "SIGPWR", "SIGSTKFLT");
}

// node_modules/signal-exit/dist/mjs/index.js
var processOk = (process10) => !!process10 && typeof process10 === "object" && typeof process10.removeListener === "function" && typeof process10.emit === "function" && typeof process10.reallyExit === "function" && typeof process10.listeners === "function" && typeof process10.kill === "function" && typeof process10.pid === "number" && typeof process10.on === "function";
var kExitEmitter = /* @__PURE__ */ Symbol.for("signal-exit emitter");
var global = globalThis;
var ObjectDefineProperty = Object.defineProperty.bind(Object);
var Emitter = class {
  emitted = {
    afterExit: false,
    exit: false
  };
  listeners = {
    afterExit: [],
    exit: []
  };
  count = 0;
  id = Math.random();
  constructor() {
    if (global[kExitEmitter]) {
      return global[kExitEmitter];
    }
    ObjectDefineProperty(global, kExitEmitter, {
      value: this,
      writable: false,
      enumerable: false,
      configurable: false
    });
  }
  on(ev, fn) {
    this.listeners[ev].push(fn);
  }
  removeListener(ev, fn) {
    const list = this.listeners[ev];
    const i = list.indexOf(fn);
    if (i === -1) {
      return;
    }
    if (i === 0 && list.length === 1) {
      list.length = 0;
    } else {
      list.splice(i, 1);
    }
  }
  emit(ev, code, signal) {
    if (this.emitted[ev]) {
      return false;
    }
    this.emitted[ev] = true;
    let ret = false;
    for (const fn of this.listeners[ev]) {
      ret = fn(code, signal) === true || ret;
    }
    if (ev === "exit") {
      ret = this.emit("afterExit", code, signal) || ret;
    }
    return ret;
  }
};
var SignalExitBase = class {
};
var signalExitWrap = (handler) => {
  return {
    onExit(cb, opts) {
      return handler.onExit(cb, opts);
    },
    load() {
      return handler.load();
    },
    unload() {
      return handler.unload();
    }
  };
};
var SignalExitFallback = class extends SignalExitBase {
  onExit() {
    return () => {
    };
  }
  load() {
  }
  unload() {
  }
};
var SignalExit = class extends SignalExitBase {
  // "SIGHUP" throws an `ENOSYS` error on Windows,
  // so use a supported signal instead
  /* c8 ignore start */
  #hupSig = process3.platform === "win32" ? "SIGINT" : "SIGHUP";
  /* c8 ignore stop */
  #emitter = new Emitter();
  #process;
  #originalProcessEmit;
  #originalProcessReallyExit;
  #sigListeners = {};
  #loaded = false;
  constructor(process10) {
    super();
    this.#process = process10;
    this.#sigListeners = {};
    for (const sig of signals) {
      this.#sigListeners[sig] = () => {
        const listeners = this.#process.listeners(sig);
        let { count } = this.#emitter;
        const p = process10;
        if (typeof p.__signal_exit_emitter__ === "object" && typeof p.__signal_exit_emitter__.count === "number") {
          count += p.__signal_exit_emitter__.count;
        }
        if (listeners.length === count) {
          this.unload();
          const ret = this.#emitter.emit("exit", null, sig);
          const s = sig === "SIGHUP" ? this.#hupSig : sig;
          if (!ret)
            process10.kill(process10.pid, s);
        }
      };
    }
    this.#originalProcessReallyExit = process10.reallyExit;
    this.#originalProcessEmit = process10.emit;
  }
  onExit(cb, opts) {
    if (!processOk(this.#process)) {
      return () => {
      };
    }
    if (this.#loaded === false) {
      this.load();
    }
    const ev = opts?.alwaysLast ? "afterExit" : "exit";
    this.#emitter.on(ev, cb);
    return () => {
      this.#emitter.removeListener(ev, cb);
      if (this.#emitter.listeners["exit"].length === 0 && this.#emitter.listeners["afterExit"].length === 0) {
        this.unload();
      }
    };
  }
  load() {
    if (this.#loaded) {
      return;
    }
    this.#loaded = true;
    this.#emitter.count += 1;
    for (const sig of signals) {
      try {
        const fn = this.#sigListeners[sig];
        if (fn)
          this.#process.on(sig, fn);
      } catch (_) {
      }
    }
    this.#process.emit = (ev, ...a) => {
      return this.#processEmit(ev, ...a);
    };
    this.#process.reallyExit = (code) => {
      return this.#processReallyExit(code);
    };
  }
  unload() {
    if (!this.#loaded) {
      return;
    }
    this.#loaded = false;
    signals.forEach((sig) => {
      const listener = this.#sigListeners[sig];
      if (!listener) {
        throw new Error("Listener not defined for signal: " + sig);
      }
      try {
        this.#process.removeListener(sig, listener);
      } catch (_) {
      }
    });
    this.#process.emit = this.#originalProcessEmit;
    this.#process.reallyExit = this.#originalProcessReallyExit;
    this.#emitter.count -= 1;
  }
  #processReallyExit(code) {
    if (!processOk(this.#process)) {
      return 0;
    }
    this.#process.exitCode = code || 0;
    this.#emitter.emit("exit", this.#process.exitCode, null);
    return this.#originalProcessReallyExit.call(this.#process, this.#process.exitCode);
  }
  #processEmit(ev, ...args) {
    const og = this.#originalProcessEmit;
    if (ev === "exit" && processOk(this.#process)) {
      if (typeof args[0] === "number") {
        this.#process.exitCode = args[0];
      }
      const ret = og.call(this.#process, ev, ...args);
      this.#emitter.emit("exit", this.#process.exitCode, null);
      return ret;
    } else {
      return og.call(this.#process, ev, ...args);
    }
  }
};
var process3 = globalThis.process;
var {
  /**
   * Called when the process is exiting, whether via signal, explicit
   * exit, or running out of stuff to do.
   *
   * If the global process object is not suitable for instrumentation,
   * then this will be a no-op.
   *
   * Returns a function that may be used to unload signal-exit.
   */
  onExit,
  /**
   * Load the listeners.  Likely you never need to call this, unless
   * doing a rather deep integration with signal-exit functionality.
   * Mostly exposed for the benefit of testing.
   *
   * @internal
   */
  load,
  /**
   * Unload the listeners.  Likely you never need to call this, unless
   * doing a rather deep integration with signal-exit functionality.
   * Mostly exposed for the benefit of testing.
   *
   * @internal
   */
  unload
} = signalExitWrap(processOk(process3) ? new SignalExit(process3) : new SignalExitFallback());

// node_modules/restore-cursor/index.js
var terminal = process4.stderr.isTTY ? process4.stderr : process4.stdout.isTTY ? process4.stdout : void 0;
var restoreCursor = terminal ? onetime_default(() => {
  onExit(() => {
    terminal.write("\x1B[?25h");
  }, { alwaysLast: true });
}) : () => {
};
var restore_cursor_default = restoreCursor;

// node_modules/cli-cursor/index.js
var isHidden = false;
var cliCursor = {};
cliCursor.show = (writableStream = process5.stderr) => {
  if (!writableStream.isTTY) {
    return;
  }
  isHidden = false;
  writableStream.write("\x1B[?25h");
};
cliCursor.hide = (writableStream = process5.stderr) => {
  if (!writableStream.isTTY) {
    return;
  }
  restore_cursor_default();
  isHidden = true;
  writableStream.write("\x1B[?25l");
};
cliCursor.toggle = (force, writableStream) => {
  if (force !== void 0) {
    isHidden = force;
  }
  if (isHidden) {
    cliCursor.show(writableStream);
  } else {
    cliCursor.hide(writableStream);
  }
};
var cli_cursor_default = cliCursor;

// node_modules/cli-spinners/spinners.json
var spinners_default = {
  dots: {
    interval: 80,
    frames: [
      "\u280B",
      "\u2819",
      "\u2839",
      "\u2838",
      "\u283C",
      "\u2834",
      "\u2826",
      "\u2827",
      "\u2807",
      "\u280F"
    ]
  },
  dots2: {
    interval: 80,
    frames: [
      "\u28FE",
      "\u28FD",
      "\u28FB",
      "\u28BF",
      "\u287F",
      "\u28DF",
      "\u28EF",
      "\u28F7"
    ]
  },
  dots3: {
    interval: 80,
    frames: [
      "\u280B",
      "\u2819",
      "\u281A",
      "\u281E",
      "\u2816",
      "\u2826",
      "\u2834",
      "\u2832",
      "\u2833",
      "\u2813"
    ]
  },
  dots4: {
    interval: 80,
    frames: [
      "\u2804",
      "\u2806",
      "\u2807",
      "\u280B",
      "\u2819",
      "\u2838",
      "\u2830",
      "\u2820",
      "\u2830",
      "\u2838",
      "\u2819",
      "\u280B",
      "\u2807",
      "\u2806"
    ]
  },
  dots5: {
    interval: 80,
    frames: [
      "\u280B",
      "\u2819",
      "\u281A",
      "\u2812",
      "\u2802",
      "\u2802",
      "\u2812",
      "\u2832",
      "\u2834",
      "\u2826",
      "\u2816",
      "\u2812",
      "\u2810",
      "\u2810",
      "\u2812",
      "\u2813",
      "\u280B"
    ]
  },
  dots6: {
    interval: 80,
    frames: [
      "\u2801",
      "\u2809",
      "\u2819",
      "\u281A",
      "\u2812",
      "\u2802",
      "\u2802",
      "\u2812",
      "\u2832",
      "\u2834",
      "\u2824",
      "\u2804",
      "\u2804",
      "\u2824",
      "\u2834",
      "\u2832",
      "\u2812",
      "\u2802",
      "\u2802",
      "\u2812",
      "\u281A",
      "\u2819",
      "\u2809",
      "\u2801"
    ]
  },
  dots7: {
    interval: 80,
    frames: [
      "\u2808",
      "\u2809",
      "\u280B",
      "\u2813",
      "\u2812",
      "\u2810",
      "\u2810",
      "\u2812",
      "\u2816",
      "\u2826",
      "\u2824",
      "\u2820",
      "\u2820",
      "\u2824",
      "\u2826",
      "\u2816",
      "\u2812",
      "\u2810",
      "\u2810",
      "\u2812",
      "\u2813",
      "\u280B",
      "\u2809",
      "\u2808"
    ]
  },
  dots8: {
    interval: 80,
    frames: [
      "\u2801",
      "\u2801",
      "\u2809",
      "\u2819",
      "\u281A",
      "\u2812",
      "\u2802",
      "\u2802",
      "\u2812",
      "\u2832",
      "\u2834",
      "\u2824",
      "\u2804",
      "\u2804",
      "\u2824",
      "\u2820",
      "\u2820",
      "\u2824",
      "\u2826",
      "\u2816",
      "\u2812",
      "\u2810",
      "\u2810",
      "\u2812",
      "\u2813",
      "\u280B",
      "\u2809",
      "\u2808",
      "\u2808"
    ]
  },
  dots9: {
    interval: 80,
    frames: [
      "\u28B9",
      "\u28BA",
      "\u28BC",
      "\u28F8",
      "\u28C7",
      "\u2867",
      "\u2857",
      "\u284F"
    ]
  },
  dots10: {
    interval: 80,
    frames: [
      "\u2884",
      "\u2882",
      "\u2881",
      "\u2841",
      "\u2848",
      "\u2850",
      "\u2860"
    ]
  },
  dots11: {
    interval: 100,
    frames: [
      "\u2801",
      "\u2802",
      "\u2804",
      "\u2840",
      "\u2880",
      "\u2820",
      "\u2810",
      "\u2808"
    ]
  },
  dots12: {
    interval: 80,
    frames: [
      "\u2880\u2800",
      "\u2840\u2800",
      "\u2804\u2800",
      "\u2882\u2800",
      "\u2842\u2800",
      "\u2805\u2800",
      "\u2883\u2800",
      "\u2843\u2800",
      "\u280D\u2800",
      "\u288B\u2800",
      "\u284B\u2800",
      "\u280D\u2801",
      "\u288B\u2801",
      "\u284B\u2801",
      "\u280D\u2809",
      "\u280B\u2809",
      "\u280B\u2809",
      "\u2809\u2819",
      "\u2809\u2819",
      "\u2809\u2829",
      "\u2808\u2899",
      "\u2808\u2859",
      "\u2888\u2829",
      "\u2840\u2899",
      "\u2804\u2859",
      "\u2882\u2829",
      "\u2842\u2898",
      "\u2805\u2858",
      "\u2883\u2828",
      "\u2843\u2890",
      "\u280D\u2850",
      "\u288B\u2820",
      "\u284B\u2880",
      "\u280D\u2841",
      "\u288B\u2801",
      "\u284B\u2801",
      "\u280D\u2809",
      "\u280B\u2809",
      "\u280B\u2809",
      "\u2809\u2819",
      "\u2809\u2819",
      "\u2809\u2829",
      "\u2808\u2899",
      "\u2808\u2859",
      "\u2808\u2829",
      "\u2800\u2899",
      "\u2800\u2859",
      "\u2800\u2829",
      "\u2800\u2898",
      "\u2800\u2858",
      "\u2800\u2828",
      "\u2800\u2890",
      "\u2800\u2850",
      "\u2800\u2820",
      "\u2800\u2880",
      "\u2800\u2840"
    ]
  },
  dots13: {
    interval: 80,
    frames: [
      "\u28FC",
      "\u28F9",
      "\u28BB",
      "\u283F",
      "\u285F",
      "\u28CF",
      "\u28E7",
      "\u28F6"
    ]
  },
  dots14: {
    interval: 80,
    frames: [
      "\u2809\u2809",
      "\u2808\u2819",
      "\u2800\u2839",
      "\u2800\u28B8",
      "\u2800\u28F0",
      "\u2880\u28E0",
      "\u28C0\u28C0",
      "\u28C4\u2840",
      "\u28C6\u2800",
      "\u2847\u2800",
      "\u280F\u2800",
      "\u280B\u2801"
    ]
  },
  dots8Bit: {
    interval: 80,
    frames: [
      "\u2800",
      "\u2801",
      "\u2802",
      "\u2803",
      "\u2804",
      "\u2805",
      "\u2806",
      "\u2807",
      "\u2840",
      "\u2841",
      "\u2842",
      "\u2843",
      "\u2844",
      "\u2845",
      "\u2846",
      "\u2847",
      "\u2808",
      "\u2809",
      "\u280A",
      "\u280B",
      "\u280C",
      "\u280D",
      "\u280E",
      "\u280F",
      "\u2848",
      "\u2849",
      "\u284A",
      "\u284B",
      "\u284C",
      "\u284D",
      "\u284E",
      "\u284F",
      "\u2810",
      "\u2811",
      "\u2812",
      "\u2813",
      "\u2814",
      "\u2815",
      "\u2816",
      "\u2817",
      "\u2850",
      "\u2851",
      "\u2852",
      "\u2853",
      "\u2854",
      "\u2855",
      "\u2856",
      "\u2857",
      "\u2818",
      "\u2819",
      "\u281A",
      "\u281B",
      "\u281C",
      "\u281D",
      "\u281E",
      "\u281F",
      "\u2858",
      "\u2859",
      "\u285A",
      "\u285B",
      "\u285C",
      "\u285D",
      "\u285E",
      "\u285F",
      "\u2820",
      "\u2821",
      "\u2822",
      "\u2823",
      "\u2824",
      "\u2825",
      "\u2826",
      "\u2827",
      "\u2860",
      "\u2861",
      "\u2862",
      "\u2863",
      "\u2864",
      "\u2865",
      "\u2866",
      "\u2867",
      "\u2828",
      "\u2829",
      "\u282A",
      "\u282B",
      "\u282C",
      "\u282D",
      "\u282E",
      "\u282F",
      "\u2868",
      "\u2869",
      "\u286A",
      "\u286B",
      "\u286C",
      "\u286D",
      "\u286E",
      "\u286F",
      "\u2830",
      "\u2831",
      "\u2832",
      "\u2833",
      "\u2834",
      "\u2835",
      "\u2836",
      "\u2837",
      "\u2870",
      "\u2871",
      "\u2872",
      "\u2873",
      "\u2874",
      "\u2875",
      "\u2876",
      "\u2877",
      "\u2838",
      "\u2839",
      "\u283A",
      "\u283B",
      "\u283C",
      "\u283D",
      "\u283E",
      "\u283F",
      "\u2878",
      "\u2879",
      "\u287A",
      "\u287B",
      "\u287C",
      "\u287D",
      "\u287E",
      "\u287F",
      "\u2880",
      "\u2881",
      "\u2882",
      "\u2883",
      "\u2884",
      "\u2885",
      "\u2886",
      "\u2887",
      "\u28C0",
      "\u28C1",
      "\u28C2",
      "\u28C3",
      "\u28C4",
      "\u28C5",
      "\u28C6",
      "\u28C7",
      "\u2888",
      "\u2889",
      "\u288A",
      "\u288B",
      "\u288C",
      "\u288D",
      "\u288E",
      "\u288F",
      "\u28C8",
      "\u28C9",
      "\u28CA",
      "\u28CB",
      "\u28CC",
      "\u28CD",
      "\u28CE",
      "\u28CF",
      "\u2890",
      "\u2891",
      "\u2892",
      "\u2893",
      "\u2894",
      "\u2895",
      "\u2896",
      "\u2897",
      "\u28D0",
      "\u28D1",
      "\u28D2",
      "\u28D3",
      "\u28D4",
      "\u28D5",
      "\u28D6",
      "\u28D7",
      "\u2898",
      "\u2899",
      "\u289A",
      "\u289B",
      "\u289C",
      "\u289D",
      "\u289E",
      "\u289F",
      "\u28D8",
      "\u28D9",
      "\u28DA",
      "\u28DB",
      "\u28DC",
      "\u28DD",
      "\u28DE",
      "\u28DF",
      "\u28A0",
      "\u28A1",
      "\u28A2",
      "\u28A3",
      "\u28A4",
      "\u28A5",
      "\u28A6",
      "\u28A7",
      "\u28E0",
      "\u28E1",
      "\u28E2",
      "\u28E3",
      "\u28E4",
      "\u28E5",
      "\u28E6",
      "\u28E7",
      "\u28A8",
      "\u28A9",
      "\u28AA",
      "\u28AB",
      "\u28AC",
      "\u28AD",
      "\u28AE",
      "\u28AF",
      "\u28E8",
      "\u28E9",
      "\u28EA",
      "\u28EB",
      "\u28EC",
      "\u28ED",
      "\u28EE",
      "\u28EF",
      "\u28B0",
      "\u28B1",
      "\u28B2",
      "\u28B3",
      "\u28B4",
      "\u28B5",
      "\u28B6",
      "\u28B7",
      "\u28F0",
      "\u28F1",
      "\u28F2",
      "\u28F3",
      "\u28F4",
      "\u28F5",
      "\u28F6",
      "\u28F7",
      "\u28B8",
      "\u28B9",
      "\u28BA",
      "\u28BB",
      "\u28BC",
      "\u28BD",
      "\u28BE",
      "\u28BF",
      "\u28F8",
      "\u28F9",
      "\u28FA",
      "\u28FB",
      "\u28FC",
      "\u28FD",
      "\u28FE",
      "\u28FF"
    ]
  },
  dotsCircle: {
    interval: 80,
    frames: [
      "\u288E ",
      "\u280E\u2801",
      "\u280A\u2811",
      "\u2808\u2831",
      " \u2871",
      "\u2880\u2870",
      "\u2884\u2860",
      "\u2886\u2840"
    ]
  },
  sand: {
    interval: 80,
    frames: [
      "\u2801",
      "\u2802",
      "\u2804",
      "\u2840",
      "\u2848",
      "\u2850",
      "\u2860",
      "\u28C0",
      "\u28C1",
      "\u28C2",
      "\u28C4",
      "\u28CC",
      "\u28D4",
      "\u28E4",
      "\u28E5",
      "\u28E6",
      "\u28EE",
      "\u28F6",
      "\u28F7",
      "\u28FF",
      "\u287F",
      "\u283F",
      "\u289F",
      "\u281F",
      "\u285B",
      "\u281B",
      "\u282B",
      "\u288B",
      "\u280B",
      "\u280D",
      "\u2849",
      "\u2809",
      "\u2811",
      "\u2821",
      "\u2881"
    ]
  },
  line: {
    interval: 130,
    frames: [
      "-",
      "\\",
      "|",
      "/"
    ]
  },
  line2: {
    interval: 100,
    frames: [
      "\u2802",
      "-",
      "\u2013",
      "\u2014",
      "\u2013",
      "-"
    ]
  },
  rollingLine: {
    interval: 80,
    frames: [
      "/  ",
      " - ",
      " \\ ",
      "  |",
      "  |",
      " \\ ",
      " - ",
      "/  "
    ]
  },
  pipe: {
    interval: 100,
    frames: [
      "\u2524",
      "\u2518",
      "\u2534",
      "\u2514",
      "\u251C",
      "\u250C",
      "\u252C",
      "\u2510"
    ]
  },
  simpleDots: {
    interval: 400,
    frames: [
      ".  ",
      ".. ",
      "...",
      "   "
    ]
  },
  simpleDotsScrolling: {
    interval: 200,
    frames: [
      ".  ",
      ".. ",
      "...",
      " ..",
      "  .",
      "   "
    ]
  },
  star: {
    interval: 70,
    frames: [
      "\u2736",
      "\u2738",
      "\u2739",
      "\u273A",
      "\u2739",
      "\u2737"
    ]
  },
  star2: {
    interval: 80,
    frames: [
      "+",
      "x",
      "*"
    ]
  },
  flip: {
    interval: 70,
    frames: [
      "_",
      "_",
      "_",
      "-",
      "`",
      "`",
      "'",
      "\xB4",
      "-",
      "_",
      "_",
      "_"
    ]
  },
  hamburger: {
    interval: 100,
    frames: [
      "\u2631",
      "\u2632",
      "\u2634"
    ]
  },
  growVertical: {
    interval: 120,
    frames: [
      "\u2581",
      "\u2583",
      "\u2584",
      "\u2585",
      "\u2586",
      "\u2587",
      "\u2586",
      "\u2585",
      "\u2584",
      "\u2583"
    ]
  },
  growHorizontal: {
    interval: 120,
    frames: [
      "\u258F",
      "\u258E",
      "\u258D",
      "\u258C",
      "\u258B",
      "\u258A",
      "\u2589",
      "\u258A",
      "\u258B",
      "\u258C",
      "\u258D",
      "\u258E"
    ]
  },
  balloon: {
    interval: 140,
    frames: [
      " ",
      ".",
      "o",
      "O",
      "@",
      "*",
      " "
    ]
  },
  balloon2: {
    interval: 120,
    frames: [
      ".",
      "o",
      "O",
      "\xB0",
      "O",
      "o",
      "."
    ]
  },
  noise: {
    interval: 100,
    frames: [
      "\u2593",
      "\u2592",
      "\u2591"
    ]
  },
  bounce: {
    interval: 120,
    frames: [
      "\u2801",
      "\u2802",
      "\u2804",
      "\u2802"
    ]
  },
  boxBounce: {
    interval: 120,
    frames: [
      "\u2596",
      "\u2598",
      "\u259D",
      "\u2597"
    ]
  },
  boxBounce2: {
    interval: 100,
    frames: [
      "\u258C",
      "\u2580",
      "\u2590",
      "\u2584"
    ]
  },
  triangle: {
    interval: 50,
    frames: [
      "\u25E2",
      "\u25E3",
      "\u25E4",
      "\u25E5"
    ]
  },
  binary: {
    interval: 80,
    frames: [
      "010010",
      "001100",
      "100101",
      "111010",
      "111101",
      "010111",
      "101011",
      "111000",
      "110011",
      "110101"
    ]
  },
  arc: {
    interval: 100,
    frames: [
      "\u25DC",
      "\u25E0",
      "\u25DD",
      "\u25DE",
      "\u25E1",
      "\u25DF"
    ]
  },
  circle: {
    interval: 120,
    frames: [
      "\u25E1",
      "\u2299",
      "\u25E0"
    ]
  },
  squareCorners: {
    interval: 180,
    frames: [
      "\u25F0",
      "\u25F3",
      "\u25F2",
      "\u25F1"
    ]
  },
  circleQuarters: {
    interval: 120,
    frames: [
      "\u25F4",
      "\u25F7",
      "\u25F6",
      "\u25F5"
    ]
  },
  circleHalves: {
    interval: 50,
    frames: [
      "\u25D0",
      "\u25D3",
      "\u25D1",
      "\u25D2"
    ]
  },
  squish: {
    interval: 100,
    frames: [
      "\u256B",
      "\u256A"
    ]
  },
  toggle: {
    interval: 250,
    frames: [
      "\u22B6",
      "\u22B7"
    ]
  },
  toggle2: {
    interval: 80,
    frames: [
      "\u25AB",
      "\u25AA"
    ]
  },
  toggle3: {
    interval: 120,
    frames: [
      "\u25A1",
      "\u25A0"
    ]
  },
  toggle4: {
    interval: 100,
    frames: [
      "\u25A0",
      "\u25A1",
      "\u25AA",
      "\u25AB"
    ]
  },
  toggle5: {
    interval: 100,
    frames: [
      "\u25AE",
      "\u25AF"
    ]
  },
  toggle6: {
    interval: 300,
    frames: [
      "\u101D",
      "\u1040"
    ]
  },
  toggle7: {
    interval: 80,
    frames: [
      "\u29BE",
      "\u29BF"
    ]
  },
  toggle8: {
    interval: 100,
    frames: [
      "\u25CD",
      "\u25CC"
    ]
  },
  toggle9: {
    interval: 100,
    frames: [
      "\u25C9",
      "\u25CE"
    ]
  },
  toggle10: {
    interval: 100,
    frames: [
      "\u3282",
      "\u3280",
      "\u3281"
    ]
  },
  toggle11: {
    interval: 50,
    frames: [
      "\u29C7",
      "\u29C6"
    ]
  },
  toggle12: {
    interval: 120,
    frames: [
      "\u2617",
      "\u2616"
    ]
  },
  toggle13: {
    interval: 80,
    frames: [
      "=",
      "*",
      "-"
    ]
  },
  arrow: {
    interval: 100,
    frames: [
      "\u2190",
      "\u2196",
      "\u2191",
      "\u2197",
      "\u2192",
      "\u2198",
      "\u2193",
      "\u2199"
    ]
  },
  arrow2: {
    interval: 80,
    frames: [
      "\u2B06\uFE0F ",
      "\u2197\uFE0F ",
      "\u27A1\uFE0F ",
      "\u2198\uFE0F ",
      "\u2B07\uFE0F ",
      "\u2199\uFE0F ",
      "\u2B05\uFE0F ",
      "\u2196\uFE0F "
    ]
  },
  arrow3: {
    interval: 120,
    frames: [
      "\u25B9\u25B9\u25B9\u25B9\u25B9",
      "\u25B8\u25B9\u25B9\u25B9\u25B9",
      "\u25B9\u25B8\u25B9\u25B9\u25B9",
      "\u25B9\u25B9\u25B8\u25B9\u25B9",
      "\u25B9\u25B9\u25B9\u25B8\u25B9",
      "\u25B9\u25B9\u25B9\u25B9\u25B8"
    ]
  },
  bouncingBar: {
    interval: 80,
    frames: [
      "[    ]",
      "[=   ]",
      "[==  ]",
      "[=== ]",
      "[====]",
      "[ ===]",
      "[  ==]",
      "[   =]",
      "[    ]",
      "[   =]",
      "[  ==]",
      "[ ===]",
      "[====]",
      "[=== ]",
      "[==  ]",
      "[=   ]"
    ]
  },
  bouncingBall: {
    interval: 80,
    frames: [
      "( \u25CF    )",
      "(  \u25CF   )",
      "(   \u25CF  )",
      "(    \u25CF )",
      "(     \u25CF)",
      "(    \u25CF )",
      "(   \u25CF  )",
      "(  \u25CF   )",
      "( \u25CF    )",
      "(\u25CF     )"
    ]
  },
  smiley: {
    interval: 200,
    frames: [
      "\u{1F604} ",
      "\u{1F61D} "
    ]
  },
  monkey: {
    interval: 300,
    frames: [
      "\u{1F648} ",
      "\u{1F648} ",
      "\u{1F649} ",
      "\u{1F64A} "
    ]
  },
  hearts: {
    interval: 100,
    frames: [
      "\u{1F49B} ",
      "\u{1F499} ",
      "\u{1F49C} ",
      "\u{1F49A} ",
      "\u{1F497} "
    ]
  },
  clock: {
    interval: 100,
    frames: [
      "\u{1F55B} ",
      "\u{1F550} ",
      "\u{1F551} ",
      "\u{1F552} ",
      "\u{1F553} ",
      "\u{1F554} ",
      "\u{1F555} ",
      "\u{1F556} ",
      "\u{1F557} ",
      "\u{1F558} ",
      "\u{1F559} ",
      "\u{1F55A} "
    ]
  },
  earth: {
    interval: 180,
    frames: [
      "\u{1F30D} ",
      "\u{1F30E} ",
      "\u{1F30F} "
    ]
  },
  material: {
    interval: 17,
    frames: [
      "\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581",
      "\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581",
      "\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581",
      "\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581",
      "\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581",
      "\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581",
      "\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581",
      "\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588",
      "\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588",
      "\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588",
      "\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588",
      "\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588",
      "\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588",
      "\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588",
      "\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581",
      "\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581",
      "\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581"
    ]
  },
  moon: {
    interval: 80,
    frames: [
      "\u{1F311} ",
      "\u{1F312} ",
      "\u{1F313} ",
      "\u{1F314} ",
      "\u{1F315} ",
      "\u{1F316} ",
      "\u{1F317} ",
      "\u{1F318} "
    ]
  },
  runner: {
    interval: 140,
    frames: [
      "\u{1F6B6} ",
      "\u{1F3C3} "
    ]
  },
  pong: {
    interval: 80,
    frames: [
      "\u2590\u2802       \u258C",
      "\u2590\u2808       \u258C",
      "\u2590 \u2802      \u258C",
      "\u2590 \u2820      \u258C",
      "\u2590  \u2840     \u258C",
      "\u2590  \u2820     \u258C",
      "\u2590   \u2802    \u258C",
      "\u2590   \u2808    \u258C",
      "\u2590    \u2802   \u258C",
      "\u2590    \u2820   \u258C",
      "\u2590     \u2840  \u258C",
      "\u2590     \u2820  \u258C",
      "\u2590      \u2802 \u258C",
      "\u2590      \u2808 \u258C",
      "\u2590       \u2802\u258C",
      "\u2590       \u2820\u258C",
      "\u2590       \u2840\u258C",
      "\u2590      \u2820 \u258C",
      "\u2590      \u2802 \u258C",
      "\u2590     \u2808  \u258C",
      "\u2590     \u2802  \u258C",
      "\u2590    \u2820   \u258C",
      "\u2590    \u2840   \u258C",
      "\u2590   \u2820    \u258C",
      "\u2590   \u2802    \u258C",
      "\u2590  \u2808     \u258C",
      "\u2590  \u2802     \u258C",
      "\u2590 \u2820      \u258C",
      "\u2590 \u2840      \u258C",
      "\u2590\u2820       \u258C"
    ]
  },
  shark: {
    interval: 120,
    frames: [
      "\u2590|\\____________\u258C",
      "\u2590_|\\___________\u258C",
      "\u2590__|\\__________\u258C",
      "\u2590___|\\_________\u258C",
      "\u2590____|\\________\u258C",
      "\u2590_____|\\_______\u258C",
      "\u2590______|\\______\u258C",
      "\u2590_______|\\_____\u258C",
      "\u2590________|\\____\u258C",
      "\u2590_________|\\___\u258C",
      "\u2590__________|\\__\u258C",
      "\u2590___________|\\_\u258C",
      "\u2590____________|\\\u258C",
      "\u2590____________/|\u258C",
      "\u2590___________/|_\u258C",
      "\u2590__________/|__\u258C",
      "\u2590_________/|___\u258C",
      "\u2590________/|____\u258C",
      "\u2590_______/|_____\u258C",
      "\u2590______/|______\u258C",
      "\u2590_____/|_______\u258C",
      "\u2590____/|________\u258C",
      "\u2590___/|_________\u258C",
      "\u2590__/|__________\u258C",
      "\u2590_/|___________\u258C",
      "\u2590/|____________\u258C"
    ]
  },
  dqpb: {
    interval: 100,
    frames: [
      "d",
      "q",
      "p",
      "b"
    ]
  },
  weather: {
    interval: 100,
    frames: [
      "\u2600\uFE0F ",
      "\u2600\uFE0F ",
      "\u2600\uFE0F ",
      "\u{1F324} ",
      "\u26C5\uFE0F ",
      "\u{1F325} ",
      "\u2601\uFE0F ",
      "\u{1F327} ",
      "\u{1F328} ",
      "\u{1F327} ",
      "\u{1F328} ",
      "\u{1F327} ",
      "\u{1F328} ",
      "\u26C8 ",
      "\u{1F328} ",
      "\u{1F327} ",
      "\u{1F328} ",
      "\u2601\uFE0F ",
      "\u{1F325} ",
      "\u26C5\uFE0F ",
      "\u{1F324} ",
      "\u2600\uFE0F ",
      "\u2600\uFE0F "
    ]
  },
  christmas: {
    interval: 400,
    frames: [
      "\u{1F332}",
      "\u{1F384}"
    ]
  },
  grenade: {
    interval: 80,
    frames: [
      "\u060C  ",
      "\u2032  ",
      " \xB4 ",
      " \u203E ",
      "  \u2E0C",
      "  \u2E0A",
      "  |",
      "  \u204E",
      "  \u2055",
      " \u0DF4 ",
      "  \u2053",
      "   ",
      "   ",
      "   "
    ]
  },
  point: {
    interval: 125,
    frames: [
      "\u2219\u2219\u2219",
      "\u25CF\u2219\u2219",
      "\u2219\u25CF\u2219",
      "\u2219\u2219\u25CF",
      "\u2219\u2219\u2219"
    ]
  },
  layer: {
    interval: 150,
    frames: [
      "-",
      "=",
      "\u2261"
    ]
  },
  betaWave: {
    interval: 80,
    frames: [
      "\u03C1\u03B2\u03B2\u03B2\u03B2\u03B2\u03B2",
      "\u03B2\u03C1\u03B2\u03B2\u03B2\u03B2\u03B2",
      "\u03B2\u03B2\u03C1\u03B2\u03B2\u03B2\u03B2",
      "\u03B2\u03B2\u03B2\u03C1\u03B2\u03B2\u03B2",
      "\u03B2\u03B2\u03B2\u03B2\u03C1\u03B2\u03B2",
      "\u03B2\u03B2\u03B2\u03B2\u03B2\u03C1\u03B2",
      "\u03B2\u03B2\u03B2\u03B2\u03B2\u03B2\u03C1"
    ]
  },
  fingerDance: {
    interval: 160,
    frames: [
      "\u{1F918} ",
      "\u{1F91F} ",
      "\u{1F596} ",
      "\u270B ",
      "\u{1F91A} ",
      "\u{1F446} "
    ]
  },
  fistBump: {
    interval: 80,
    frames: [
      "\u{1F91C}\u3000\u3000\u3000\u3000\u{1F91B} ",
      "\u{1F91C}\u3000\u3000\u3000\u3000\u{1F91B} ",
      "\u{1F91C}\u3000\u3000\u3000\u3000\u{1F91B} ",
      "\u3000\u{1F91C}\u3000\u3000\u{1F91B}\u3000 ",
      "\u3000\u3000\u{1F91C}\u{1F91B}\u3000\u3000 ",
      "\u3000\u{1F91C}\u2728\u{1F91B}\u3000\u3000 ",
      "\u{1F91C}\u3000\u2728\u3000\u{1F91B}\u3000 "
    ]
  },
  soccerHeader: {
    interval: 80,
    frames: [
      " \u{1F9D1}\u26BD\uFE0F       \u{1F9D1} ",
      "\u{1F9D1}  \u26BD\uFE0F      \u{1F9D1} ",
      "\u{1F9D1}   \u26BD\uFE0F     \u{1F9D1} ",
      "\u{1F9D1}    \u26BD\uFE0F    \u{1F9D1} ",
      "\u{1F9D1}     \u26BD\uFE0F   \u{1F9D1} ",
      "\u{1F9D1}      \u26BD\uFE0F  \u{1F9D1} ",
      "\u{1F9D1}       \u26BD\uFE0F\u{1F9D1}  ",
      "\u{1F9D1}      \u26BD\uFE0F  \u{1F9D1} ",
      "\u{1F9D1}     \u26BD\uFE0F   \u{1F9D1} ",
      "\u{1F9D1}    \u26BD\uFE0F    \u{1F9D1} ",
      "\u{1F9D1}   \u26BD\uFE0F     \u{1F9D1} ",
      "\u{1F9D1}  \u26BD\uFE0F      \u{1F9D1} "
    ]
  },
  mindblown: {
    interval: 160,
    frames: [
      "\u{1F610} ",
      "\u{1F610} ",
      "\u{1F62E} ",
      "\u{1F62E} ",
      "\u{1F626} ",
      "\u{1F626} ",
      "\u{1F627} ",
      "\u{1F627} ",
      "\u{1F92F} ",
      "\u{1F4A5} ",
      "\u2728 ",
      "\u3000 ",
      "\u3000 ",
      "\u3000 "
    ]
  },
  speaker: {
    interval: 160,
    frames: [
      "\u{1F508} ",
      "\u{1F509} ",
      "\u{1F50A} ",
      "\u{1F509} "
    ]
  },
  orangePulse: {
    interval: 100,
    frames: [
      "\u{1F538} ",
      "\u{1F536} ",
      "\u{1F7E0} ",
      "\u{1F7E0} ",
      "\u{1F536} "
    ]
  },
  bluePulse: {
    interval: 100,
    frames: [
      "\u{1F539} ",
      "\u{1F537} ",
      "\u{1F535} ",
      "\u{1F535} ",
      "\u{1F537} "
    ]
  },
  orangeBluePulse: {
    interval: 100,
    frames: [
      "\u{1F538} ",
      "\u{1F536} ",
      "\u{1F7E0} ",
      "\u{1F7E0} ",
      "\u{1F536} ",
      "\u{1F539} ",
      "\u{1F537} ",
      "\u{1F535} ",
      "\u{1F535} ",
      "\u{1F537} "
    ]
  },
  timeTravel: {
    interval: 100,
    frames: [
      "\u{1F55B} ",
      "\u{1F55A} ",
      "\u{1F559} ",
      "\u{1F558} ",
      "\u{1F557} ",
      "\u{1F556} ",
      "\u{1F555} ",
      "\u{1F554} ",
      "\u{1F553} ",
      "\u{1F552} ",
      "\u{1F551} ",
      "\u{1F550} "
    ]
  },
  aesthetic: {
    interval: 80,
    frames: [
      "\u25B0\u25B1\u25B1\u25B1\u25B1\u25B1\u25B1",
      "\u25B0\u25B0\u25B1\u25B1\u25B1\u25B1\u25B1",
      "\u25B0\u25B0\u25B0\u25B1\u25B1\u25B1\u25B1",
      "\u25B0\u25B0\u25B0\u25B0\u25B1\u25B1\u25B1",
      "\u25B0\u25B0\u25B0\u25B0\u25B0\u25B1\u25B1",
      "\u25B0\u25B0\u25B0\u25B0\u25B0\u25B0\u25B1",
      "\u25B0\u25B0\u25B0\u25B0\u25B0\u25B0\u25B0",
      "\u25B0\u25B1\u25B1\u25B1\u25B1\u25B1\u25B1"
    ]
  },
  dwarfFortress: {
    interval: 80,
    frames: [
      " \u2588\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "\u263A\u2588\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "\u263A\u2588\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "\u263A\u2593\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "\u263A\u2593\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "\u263A\u2592\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "\u263A\u2592\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "\u263A\u2591\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "\u263A\u2591\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "\u263A \u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      " \u263A\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      " \u263A\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      " \u263A\u2593\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      " \u263A\u2593\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      " \u263A\u2592\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      " \u263A\u2592\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      " \u263A\u2591\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      " \u263A\u2591\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      " \u263A \u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "  \u263A\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "  \u263A\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "  \u263A\u2593\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "  \u263A\u2593\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "  \u263A\u2592\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "  \u263A\u2592\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "  \u263A\u2591\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "  \u263A\u2591\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "  \u263A \u2588\u2588\u2588\xA3\xA3\xA3  ",
      "   \u263A\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "   \u263A\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "   \u263A\u2593\u2588\u2588\xA3\xA3\xA3  ",
      "   \u263A\u2593\u2588\u2588\xA3\xA3\xA3  ",
      "   \u263A\u2592\u2588\u2588\xA3\xA3\xA3  ",
      "   \u263A\u2592\u2588\u2588\xA3\xA3\xA3  ",
      "   \u263A\u2591\u2588\u2588\xA3\xA3\xA3  ",
      "   \u263A\u2591\u2588\u2588\xA3\xA3\xA3  ",
      "   \u263A \u2588\u2588\xA3\xA3\xA3  ",
      "    \u263A\u2588\u2588\xA3\xA3\xA3  ",
      "    \u263A\u2588\u2588\xA3\xA3\xA3  ",
      "    \u263A\u2593\u2588\xA3\xA3\xA3  ",
      "    \u263A\u2593\u2588\xA3\xA3\xA3  ",
      "    \u263A\u2592\u2588\xA3\xA3\xA3  ",
      "    \u263A\u2592\u2588\xA3\xA3\xA3  ",
      "    \u263A\u2591\u2588\xA3\xA3\xA3  ",
      "    \u263A\u2591\u2588\xA3\xA3\xA3  ",
      "    \u263A \u2588\xA3\xA3\xA3  ",
      "     \u263A\u2588\xA3\xA3\xA3  ",
      "     \u263A\u2588\xA3\xA3\xA3  ",
      "     \u263A\u2593\xA3\xA3\xA3  ",
      "     \u263A\u2593\xA3\xA3\xA3  ",
      "     \u263A\u2592\xA3\xA3\xA3  ",
      "     \u263A\u2592\xA3\xA3\xA3  ",
      "     \u263A\u2591\xA3\xA3\xA3  ",
      "     \u263A\u2591\xA3\xA3\xA3  ",
      "     \u263A \xA3\xA3\xA3  ",
      "      \u263A\xA3\xA3\xA3  ",
      "      \u263A\xA3\xA3\xA3  ",
      "      \u263A\u2593\xA3\xA3  ",
      "      \u263A\u2593\xA3\xA3  ",
      "      \u263A\u2592\xA3\xA3  ",
      "      \u263A\u2592\xA3\xA3  ",
      "      \u263A\u2591\xA3\xA3  ",
      "      \u263A\u2591\xA3\xA3  ",
      "      \u263A \xA3\xA3  ",
      "       \u263A\xA3\xA3  ",
      "       \u263A\xA3\xA3  ",
      "       \u263A\u2593\xA3  ",
      "       \u263A\u2593\xA3  ",
      "       \u263A\u2592\xA3  ",
      "       \u263A\u2592\xA3  ",
      "       \u263A\u2591\xA3  ",
      "       \u263A\u2591\xA3  ",
      "       \u263A \xA3  ",
      "        \u263A\xA3  ",
      "        \u263A\xA3  ",
      "        \u263A\u2593  ",
      "        \u263A\u2593  ",
      "        \u263A\u2592  ",
      "        \u263A\u2592  ",
      "        \u263A\u2591  ",
      "        \u263A\u2591  ",
      "        \u263A   ",
      "        \u263A  &",
      "        \u263A \u263C&",
      "       \u263A \u263C &",
      "       \u263A\u263C  &",
      "      \u263A\u263C  & ",
      "      \u203C   & ",
      "     \u263A   &  ",
      "    \u203C    &  ",
      "   \u263A    &   ",
      "  \u203C     &   ",
      " \u263A     &    ",
      "\u203C      &    ",
      "      &     ",
      "      &     ",
      "     &   \u2591  ",
      "     &   \u2592  ",
      "    &    \u2593  ",
      "    &    \xA3  ",
      "   &    \u2591\xA3  ",
      "   &    \u2592\xA3  ",
      "  &     \u2593\xA3  ",
      "  &     \xA3\xA3  ",
      " &     \u2591\xA3\xA3  ",
      " &     \u2592\xA3\xA3  ",
      "&      \u2593\xA3\xA3  ",
      "&      \xA3\xA3\xA3  ",
      "      \u2591\xA3\xA3\xA3  ",
      "      \u2592\xA3\xA3\xA3  ",
      "      \u2593\xA3\xA3\xA3  ",
      "      \u2588\xA3\xA3\xA3  ",
      "     \u2591\u2588\xA3\xA3\xA3  ",
      "     \u2592\u2588\xA3\xA3\xA3  ",
      "     \u2593\u2588\xA3\xA3\xA3  ",
      "     \u2588\u2588\xA3\xA3\xA3  ",
      "    \u2591\u2588\u2588\xA3\xA3\xA3  ",
      "    \u2592\u2588\u2588\xA3\xA3\xA3  ",
      "    \u2593\u2588\u2588\xA3\xA3\xA3  ",
      "    \u2588\u2588\u2588\xA3\xA3\xA3  ",
      "   \u2591\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "   \u2592\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "   \u2593\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "   \u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "  \u2591\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "  \u2592\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "  \u2593\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "  \u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      " \u2591\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      " \u2592\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      " \u2593\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      " \u2588\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      " \u2588\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  "
    ]
  },
  fish: {
    interval: 80,
    frames: [
      "~~~~~~~~~~~~~~~~~~~~",
      "> ~~~~~~~~~~~~~~~~~~",
      "\xBA> ~~~~~~~~~~~~~~~~~",
      "(\xBA> ~~~~~~~~~~~~~~~~",
      "((\xBA> ~~~~~~~~~~~~~~~",
      "<((\xBA> ~~~~~~~~~~~~~~",
      "><((\xBA> ~~~~~~~~~~~~~",
      " ><((\xBA> ~~~~~~~~~~~~",
      "~ ><((\xBA> ~~~~~~~~~~~",
      "~~ <>((\xBA> ~~~~~~~~~~",
      "~~~ ><((\xBA> ~~~~~~~~~",
      "~~~~ <>((\xBA> ~~~~~~~~",
      "~~~~~ ><((\xBA> ~~~~~~~",
      "~~~~~~ <>((\xBA> ~~~~~~",
      "~~~~~~~ ><((\xBA> ~~~~~",
      "~~~~~~~~ <>((\xBA> ~~~~",
      "~~~~~~~~~ ><((\xBA> ~~~",
      "~~~~~~~~~~ <>((\xBA> ~~",
      "~~~~~~~~~~~ ><((\xBA> ~",
      "~~~~~~~~~~~~ <>((\xBA> ",
      "~~~~~~~~~~~~~ ><((\xBA>",
      "~~~~~~~~~~~~~~ <>((\xBA",
      "~~~~~~~~~~~~~~~ ><((",
      "~~~~~~~~~~~~~~~~ <>(",
      "~~~~~~~~~~~~~~~~~ ><",
      "~~~~~~~~~~~~~~~~~~ <",
      "~~~~~~~~~~~~~~~~~~~~"
    ]
  }
};

// node_modules/cli-spinners/index.js
var cli_spinners_default = spinners_default;
var spinnersList = Object.keys(spinners_default);

// node_modules/log-symbols/symbols.js
var symbols_exports = {};
__export(symbols_exports, {
  error: () => error,
  info: () => info,
  success: () => success,
  warning: () => warning
});

// node_modules/yoctocolors/base.js
import tty2 from "tty";
var hasColors = tty2?.WriteStream?.prototype?.hasColors?.() ?? false;
var format = (open, close) => {
  if (!hasColors) {
    return (input) => input;
  }
  const openCode = `\x1B[${open}m`;
  const closeCode = `\x1B[${close}m`;
  return (input) => {
    const string = input + "";
    let index = string.indexOf(closeCode);
    if (index === -1) {
      return openCode + string + closeCode;
    }
    let result = openCode;
    let lastIndex = 0;
    const reopenOnNestedClose = close === 22;
    const replaceCode = (reopenOnNestedClose ? closeCode : "") + openCode;
    while (index !== -1) {
      result += string.slice(lastIndex, index) + replaceCode;
      lastIndex = index + closeCode.length;
      index = string.indexOf(closeCode, lastIndex);
    }
    result += string.slice(lastIndex) + closeCode;
    return result;
  };
};
var reset = format(0, 0);
var bold = format(1, 22);
var dim = format(2, 22);
var italic = format(3, 23);
var underline = format(4, 24);
var overline = format(53, 55);
var inverse = format(7, 27);
var hidden = format(8, 28);
var strikethrough = format(9, 29);
var black = format(30, 39);
var red = format(31, 39);
var green = format(32, 39);
var yellow = format(33, 39);
var blue = format(34, 39);
var magenta = format(35, 39);
var cyan = format(36, 39);
var white = format(37, 39);
var gray = format(90, 39);
var bgBlack = format(40, 49);
var bgRed = format(41, 49);
var bgGreen = format(42, 49);
var bgYellow = format(43, 49);
var bgBlue = format(44, 49);
var bgMagenta = format(45, 49);
var bgCyan = format(46, 49);
var bgWhite = format(47, 49);
var bgGray = format(100, 49);
var redBright = format(91, 39);
var greenBright = format(92, 39);
var yellowBright = format(93, 39);
var blueBright = format(94, 39);
var magentaBright = format(95, 39);
var cyanBright = format(96, 39);
var whiteBright = format(97, 39);
var bgRedBright = format(101, 49);
var bgGreenBright = format(102, 49);
var bgYellowBright = format(103, 49);
var bgBlueBright = format(104, 49);
var bgMagentaBright = format(105, 49);
var bgCyanBright = format(106, 49);
var bgWhiteBright = format(107, 49);

// node_modules/is-unicode-supported/index.js
import process6 from "process";
function isUnicodeSupported() {
  const { env: env2 } = process6;
  const { TERM, TERM_PROGRAM } = env2;
  if (process6.platform !== "win32") {
    return TERM !== "linux";
  }
  return Boolean(env2.WT_SESSION) || Boolean(env2.TERMINUS_SUBLIME) || env2.ConEmuTask === "{cmd::Cmder}" || TERM_PROGRAM === "Terminus-Sublime" || TERM_PROGRAM === "vscode" || TERM === "xterm-256color" || TERM === "alacritty" || TERM === "rxvt-unicode" || TERM === "rxvt-unicode-256color" || env2.TERMINAL_EMULATOR === "JetBrains-JediTerm";
}

// node_modules/log-symbols/symbols.js
var _isUnicodeSupported = isUnicodeSupported();
var info = blue(_isUnicodeSupported ? "\u2139" : "i");
var success = green(_isUnicodeSupported ? "\u2714" : "\u221A");
var warning = yellow(_isUnicodeSupported ? "\u26A0" : "\u203C");
var error = red(_isUnicodeSupported ? "\u2716" : "\xD7");

// node_modules/ansi-regex/index.js
function ansiRegex({ onlyFirst = false } = {}) {
  const ST = "(?:\\u0007|\\u001B\\u005C|\\u009C)";
  const osc = `(?:\\u001B\\][\\s\\S]*?${ST})`;
  const csi = "[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]";
  const pattern = `${osc}|${csi}`;
  return new RegExp(pattern, onlyFirst ? void 0 : "g");
}

// node_modules/strip-ansi/index.js
var regex = ansiRegex();
function stripAnsi(string) {
  if (typeof string !== "string") {
    throw new TypeError(`Expected a \`string\`, got \`${typeof string}\``);
  }
  return string.replace(regex, "");
}

// node_modules/get-east-asian-width/lookup-data.js
var ambiguousRanges = [161, 161, 164, 164, 167, 168, 170, 170, 173, 174, 176, 180, 182, 186, 188, 191, 198, 198, 208, 208, 215, 216, 222, 225, 230, 230, 232, 234, 236, 237, 240, 240, 242, 243, 247, 250, 252, 252, 254, 254, 257, 257, 273, 273, 275, 275, 283, 283, 294, 295, 299, 299, 305, 307, 312, 312, 319, 322, 324, 324, 328, 331, 333, 333, 338, 339, 358, 359, 363, 363, 462, 462, 464, 464, 466, 466, 468, 468, 470, 470, 472, 472, 474, 474, 476, 476, 593, 593, 609, 609, 708, 708, 711, 711, 713, 715, 717, 717, 720, 720, 728, 731, 733, 733, 735, 735, 768, 879, 913, 929, 931, 937, 945, 961, 963, 969, 1025, 1025, 1040, 1103, 1105, 1105, 8208, 8208, 8211, 8214, 8216, 8217, 8220, 8221, 8224, 8226, 8228, 8231, 8240, 8240, 8242, 8243, 8245, 8245, 8251, 8251, 8254, 8254, 8308, 8308, 8319, 8319, 8321, 8324, 8364, 8364, 8451, 8451, 8453, 8453, 8457, 8457, 8467, 8467, 8470, 8470, 8481, 8482, 8486, 8486, 8491, 8491, 8531, 8532, 8539, 8542, 8544, 8555, 8560, 8569, 8585, 8585, 8592, 8601, 8632, 8633, 8658, 8658, 8660, 8660, 8679, 8679, 8704, 8704, 8706, 8707, 8711, 8712, 8715, 8715, 8719, 8719, 8721, 8721, 8725, 8725, 8730, 8730, 8733, 8736, 8739, 8739, 8741, 8741, 8743, 8748, 8750, 8750, 8756, 8759, 8764, 8765, 8776, 8776, 8780, 8780, 8786, 8786, 8800, 8801, 8804, 8807, 8810, 8811, 8814, 8815, 8834, 8835, 8838, 8839, 8853, 8853, 8857, 8857, 8869, 8869, 8895, 8895, 8978, 8978, 9312, 9449, 9451, 9547, 9552, 9587, 9600, 9615, 9618, 9621, 9632, 9633, 9635, 9641, 9650, 9651, 9654, 9655, 9660, 9661, 9664, 9665, 9670, 9672, 9675, 9675, 9678, 9681, 9698, 9701, 9711, 9711, 9733, 9734, 9737, 9737, 9742, 9743, 9756, 9756, 9758, 9758, 9792, 9792, 9794, 9794, 9824, 9825, 9827, 9829, 9831, 9834, 9836, 9837, 9839, 9839, 9886, 9887, 9919, 9919, 9926, 9933, 9935, 9939, 9941, 9953, 9955, 9955, 9960, 9961, 9963, 9969, 9972, 9972, 9974, 9977, 9979, 9980, 9982, 9983, 10045, 10045, 10102, 10111, 11094, 11097, 12872, 12879, 57344, 63743, 65024, 65039, 65533, 65533, 127232, 127242, 127248, 127277, 127280, 127337, 127344, 127373, 127375, 127376, 127387, 127404, 917760, 917999, 983040, 1048573, 1048576, 1114109];
var fullwidthRanges = [12288, 12288, 65281, 65376, 65504, 65510];
var halfwidthRanges = [8361, 8361, 65377, 65470, 65474, 65479, 65482, 65487, 65490, 65495, 65498, 65500, 65512, 65518];
var narrowRanges = [32, 126, 162, 163, 165, 166, 172, 172, 175, 175, 10214, 10221, 10629, 10630];
var wideRanges = [4352, 4447, 8986, 8987, 9001, 9002, 9193, 9196, 9200, 9200, 9203, 9203, 9725, 9726, 9748, 9749, 9776, 9783, 9800, 9811, 9855, 9855, 9866, 9871, 9875, 9875, 9889, 9889, 9898, 9899, 9917, 9918, 9924, 9925, 9934, 9934, 9940, 9940, 9962, 9962, 9970, 9971, 9973, 9973, 9978, 9978, 9981, 9981, 9989, 9989, 9994, 9995, 10024, 10024, 10060, 10060, 10062, 10062, 10067, 10069, 10071, 10071, 10133, 10135, 10160, 10160, 10175, 10175, 11035, 11036, 11088, 11088, 11093, 11093, 11904, 11929, 11931, 12019, 12032, 12245, 12272, 12287, 12289, 12350, 12353, 12438, 12441, 12543, 12549, 12591, 12593, 12686, 12688, 12773, 12783, 12830, 12832, 12871, 12880, 42124, 42128, 42182, 43360, 43388, 44032, 55203, 63744, 64255, 65040, 65049, 65072, 65106, 65108, 65126, 65128, 65131, 94176, 94180, 94192, 94198, 94208, 101589, 101631, 101662, 101760, 101874, 110576, 110579, 110581, 110587, 110589, 110590, 110592, 110882, 110898, 110898, 110928, 110930, 110933, 110933, 110948, 110951, 110960, 111355, 119552, 119638, 119648, 119670, 126980, 126980, 127183, 127183, 127374, 127374, 127377, 127386, 127488, 127490, 127504, 127547, 127552, 127560, 127568, 127569, 127584, 127589, 127744, 127776, 127789, 127797, 127799, 127868, 127870, 127891, 127904, 127946, 127951, 127955, 127968, 127984, 127988, 127988, 127992, 128062, 128064, 128064, 128066, 128252, 128255, 128317, 128331, 128334, 128336, 128359, 128378, 128378, 128405, 128406, 128420, 128420, 128507, 128591, 128640, 128709, 128716, 128716, 128720, 128722, 128725, 128728, 128732, 128735, 128747, 128748, 128756, 128764, 128992, 129003, 129008, 129008, 129292, 129338, 129340, 129349, 129351, 129535, 129648, 129660, 129664, 129674, 129678, 129734, 129736, 129736, 129741, 129756, 129759, 129770, 129775, 129784, 131072, 196605, 196608, 262141];

// node_modules/get-east-asian-width/utilities.js
var isInRange = (ranges, codePoint) => {
  let low = 0;
  let high = Math.floor(ranges.length / 2) - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const i = mid * 2;
    if (codePoint < ranges[i]) {
      high = mid - 1;
    } else if (codePoint > ranges[i + 1]) {
      low = mid + 1;
    } else {
      return true;
    }
  }
  return false;
};

// node_modules/get-east-asian-width/lookup.js
var minimumAmbiguousCodePoint = ambiguousRanges[0];
var maximumAmbiguousCodePoint = ambiguousRanges.at(-1);
var minimumFullWidthCodePoint = fullwidthRanges[0];
var maximumFullWidthCodePoint = fullwidthRanges.at(-1);
var minimumHalfWidthCodePoint = halfwidthRanges[0];
var maximumHalfWidthCodePoint = halfwidthRanges.at(-1);
var minimumNarrowCodePoint = narrowRanges[0];
var maximumNarrowCodePoint = narrowRanges.at(-1);
var minimumWideCodePoint = wideRanges[0];
var maximumWideCodePoint = wideRanges.at(-1);
var commonCjkCodePoint = 19968;
var [wideFastPathStart, wideFastPathEnd] = findWideFastPathRange(wideRanges);
function findWideFastPathRange(ranges) {
  let fastPathStart = ranges[0];
  let fastPathEnd = ranges[1];
  for (let index = 0; index < ranges.length; index += 2) {
    const start = ranges[index];
    const end = ranges[index + 1];
    if (commonCjkCodePoint >= start && commonCjkCodePoint <= end) {
      return [start, end];
    }
    if (end - start > fastPathEnd - fastPathStart) {
      fastPathStart = start;
      fastPathEnd = end;
    }
  }
  return [fastPathStart, fastPathEnd];
}
var isAmbiguous = (codePoint) => {
  if (codePoint < minimumAmbiguousCodePoint || codePoint > maximumAmbiguousCodePoint) {
    return false;
  }
  return isInRange(ambiguousRanges, codePoint);
};
var isFullWidth = (codePoint) => {
  if (codePoint < minimumFullWidthCodePoint || codePoint > maximumFullWidthCodePoint) {
    return false;
  }
  return isInRange(fullwidthRanges, codePoint);
};
var isWide = (codePoint) => {
  if (codePoint >= wideFastPathStart && codePoint <= wideFastPathEnd) {
    return true;
  }
  if (codePoint < minimumWideCodePoint || codePoint > maximumWideCodePoint) {
    return false;
  }
  return isInRange(wideRanges, codePoint);
};

// node_modules/get-east-asian-width/index.js
function validate(codePoint) {
  if (!Number.isSafeInteger(codePoint)) {
    throw new TypeError(`Expected a code point, got \`${typeof codePoint}\`.`);
  }
}
function eastAsianWidth(codePoint, { ambiguousAsWide = false } = {}) {
  validate(codePoint);
  if (isFullWidth(codePoint) || isWide(codePoint) || ambiguousAsWide && isAmbiguous(codePoint)) {
    return 2;
  }
  return 1;
}

// node_modules/string-width/index.js
var segmenter = new Intl.Segmenter();
var zeroWidthClusterRegex = new RegExp("^(?:\\p{Default_Ignorable_Code_Point}|\\p{Control}|\\p{Format}|\\p{Mark}|\\p{Surrogate})+$", "v");
var leadingNonPrintingRegex = new RegExp("^[\\p{Default_Ignorable_Code_Point}\\p{Control}\\p{Format}\\p{Mark}\\p{Surrogate}]+", "v");
var rgiEmojiRegex = new RegExp("^\\p{RGI_Emoji}$", "v");
var unqualifiedKeycapRegex = /^[\d#*]\u20E3$/;
var extendedPictographicRegex = /\p{Extended_Pictographic}/gu;
function isDoubleWidthNonRgiEmojiSequence(segment) {
  if (segment.length > 50) {
    return false;
  }
  if (unqualifiedKeycapRegex.test(segment)) {
    return true;
  }
  if (segment.includes("\u200D")) {
    const pictographics = segment.match(extendedPictographicRegex);
    return pictographics !== null && pictographics.length >= 2;
  }
  return false;
}
function baseVisible(segment) {
  return segment.replace(leadingNonPrintingRegex, "");
}
function isZeroWidthCluster(segment) {
  return zeroWidthClusterRegex.test(segment);
}
function trailingHalfwidthWidth(segment, eastAsianWidthOptions) {
  let extra = 0;
  if (segment.length > 1) {
    for (const char of segment.slice(1)) {
      if (char >= "\uFF00" && char <= "\uFFEF") {
        extra += eastAsianWidth(char.codePointAt(0), eastAsianWidthOptions);
      }
    }
  }
  return extra;
}
function stringWidth(input, options = {}) {
  if (typeof input !== "string" || input.length === 0) {
    return 0;
  }
  const {
    ambiguousIsNarrow = true,
    countAnsiEscapeCodes = false
  } = options;
  let string = input;
  if (!countAnsiEscapeCodes && (string.includes("\x1B") || string.includes("\x9B"))) {
    string = stripAnsi(string);
  }
  if (string.length === 0) {
    return 0;
  }
  if (/^[\u0020-\u007E]*$/.test(string)) {
    return string.length;
  }
  let width = 0;
  const eastAsianWidthOptions = { ambiguousAsWide: !ambiguousIsNarrow };
  for (const { segment } of segmenter.segment(string)) {
    if (isZeroWidthCluster(segment)) {
      continue;
    }
    if (rgiEmojiRegex.test(segment) || isDoubleWidthNonRgiEmojiSequence(segment)) {
      width += 2;
      continue;
    }
    const codePoint = baseVisible(segment).codePointAt(0);
    width += eastAsianWidth(codePoint, eastAsianWidthOptions);
    width += trailingHalfwidthWidth(segment, eastAsianWidthOptions);
  }
  return width;
}

// node_modules/is-interactive/index.js
function isInteractive({ stream = process.stdout } = {}) {
  return Boolean(
    stream && stream.isTTY && process.env.TERM !== "dumb" && !("CI" in process.env)
  );
}

// node_modules/stdin-discarder/index.js
import process7 from "process";
var ASCII_ETX_CODE = 3;
var StdinDiscarder = class {
  #activeCount = 0;
  #stdin;
  #stdinWasPaused = false;
  #stdinWasRaw = false;
  #handleInputBound = (chunk) => {
    if (!chunk?.length) {
      return;
    }
    const code = typeof chunk === "string" ? chunk.codePointAt(0) : chunk[0];
    if (code === ASCII_ETX_CODE) {
      if (process7.listenerCount("SIGINT") > 0) {
        process7.emit("SIGINT");
      } else {
        process7.kill(process7.pid, "SIGINT");
      }
    }
  };
  start() {
    this.#activeCount++;
    if (this.#activeCount === 1) {
      this.#realStart();
    }
  }
  stop() {
    if (this.#activeCount === 0) {
      return;
    }
    if (--this.#activeCount === 0) {
      this.#realStop();
    }
  }
  #realStart() {
    const { stdin } = process7;
    if (process7.platform === "win32" || !stdin?.isTTY || typeof stdin.setRawMode !== "function") {
      this.#stdin = void 0;
      return;
    }
    this.#stdin = stdin;
    this.#stdinWasPaused = stdin.isPaused();
    this.#stdinWasRaw = Boolean(stdin.isRaw);
    stdin.setRawMode(true);
    stdin.prependListener("data", this.#handleInputBound);
    if (this.#stdinWasPaused) {
      stdin.resume();
    }
  }
  #realStop() {
    if (!this.#stdin) {
      return;
    }
    const stdin = this.#stdin;
    stdin.off("data", this.#handleInputBound);
    if (stdin.isTTY) {
      stdin.setRawMode?.(this.#stdinWasRaw);
    }
    if (this.#stdinWasPaused) {
      stdin.pause();
    }
    this.#stdin = void 0;
    this.#stdinWasPaused = false;
    this.#stdinWasRaw = false;
  }
};
var stdinDiscarder = new StdinDiscarder();
var stdin_discarder_default = Object.freeze(stdinDiscarder);

// node_modules/ora/index.js
var RENDER_DEFERRAL_TIMEOUT = 200;
var SYNCHRONIZED_OUTPUT_ENABLE = "\x1B[?2026h";
var SYNCHRONIZED_OUTPUT_DISABLE = "\x1B[?2026l";
var activeHooksPerStream = /* @__PURE__ */ new Map();
var Ora = class {
  #linesToClear = 0;
  #frameIndex = -1;
  #lastFrameTime = 0;
  #options;
  #spinner;
  #stream;
  #id;
  #hookedStreams = /* @__PURE__ */ new Map();
  #isInternalWrite = false;
  #drainHandler;
  #deferRenderTimer;
  #isDiscardingStdin = false;
  color;
  // Helper to execute writes while preventing hook recursion
  #internalWrite(fn) {
    this.#isInternalWrite = true;
    try {
      return fn();
    } finally {
      this.#isInternalWrite = false;
    }
  }
  // Helper to render if still spinning
  #tryRender() {
    if (this.isSpinning) {
      this.render();
    }
  }
  #stringifyChunk(chunk, encoding) {
    if (chunk === void 0 || chunk === null) {
      return "";
    }
    if (typeof chunk === "string") {
      return chunk;
    }
    if (Buffer.isBuffer(chunk) || ArrayBuffer.isView(chunk)) {
      const normalizedEncoding = typeof encoding === "string" && encoding && encoding !== "buffer" ? encoding : "utf8";
      return Buffer.from(chunk).toString(normalizedEncoding);
    }
    return String(chunk);
  }
  #chunkTerminatesLine(chunkString) {
    if (!chunkString) {
      return false;
    }
    const lastCharacter = chunkString.at(-1);
    return lastCharacter === "\n" || lastCharacter === "\r";
  }
  #scheduleRenderDeferral() {
    if (this.#deferRenderTimer) {
      return;
    }
    this.#deferRenderTimer = setTimeout(() => {
      this.#deferRenderTimer = void 0;
      if (this.isSpinning) {
        this.#tryRender();
      }
    }, RENDER_DEFERRAL_TIMEOUT);
    if (typeof this.#deferRenderTimer?.unref === "function") {
      this.#deferRenderTimer.unref();
    }
  }
  #clearRenderDeferral() {
    if (this.#deferRenderTimer) {
      clearTimeout(this.#deferRenderTimer);
      this.#deferRenderTimer = void 0;
    }
  }
  // Helper to build complete line with symbol, text, prefix, and suffix
  #buildOutputLine(symbol, text, prefixText, suffixText) {
    const fullPrefixText = this.#getFullPrefixText(prefixText, " ");
    const separatorText = symbol ? " " : "";
    const fullText = typeof text === "string" ? separatorText + text : "";
    const fullSuffixText = this.#getFullSuffixText(suffixText, " ");
    return fullPrefixText + symbol + fullText + fullSuffixText;
  }
  constructor(options) {
    if (typeof options === "string") {
      options = {
        text: options
      };
    }
    this.#options = {
      color: "cyan",
      stream: process8.stderr,
      discardStdin: true,
      hideCursor: true,
      ...options
    };
    this.color = this.#options.color;
    this.#stream = this.#options.stream;
    if (typeof this.#options.isEnabled !== "boolean") {
      this.#options.isEnabled = isInteractive({ stream: this.#stream });
    }
    if (typeof this.#options.isSilent !== "boolean") {
      this.#options.isSilent = false;
    }
    const userInterval = this.#options.interval;
    this.spinner = this.#options.spinner;
    this.#options.interval = userInterval;
    this.text = this.#options.text;
    this.prefixText = this.#options.prefixText;
    this.suffixText = this.#options.suffixText;
    this.indent = this.#options.indent;
    if (process8.env.NODE_ENV === "test") {
      this._stream = this.#stream;
      this._isEnabled = this.#options.isEnabled;
      Object.defineProperty(this, "_linesToClear", {
        get() {
          return this.#linesToClear;
        },
        set(newValue) {
          this.#linesToClear = newValue;
        }
      });
      Object.defineProperty(this, "_frameIndex", {
        get() {
          return this.#frameIndex;
        }
      });
      Object.defineProperty(this, "_lineCount", {
        get() {
          const columns = this.#stream.columns ?? 80;
          const prefixText = typeof this.#options.prefixText === "function" ? "" : this.#options.prefixText;
          const suffixText = typeof this.#options.suffixText === "function" ? "" : this.#options.suffixText;
          const fullPrefixText = typeof prefixText === "string" && prefixText !== "" ? prefixText + " " : "";
          const fullSuffixText = typeof suffixText === "string" && suffixText !== "" ? " " + suffixText : "";
          const spinnerChar = "-";
          const fullText = " ".repeat(this.#options.indent) + fullPrefixText + spinnerChar + (typeof this.#options.text === "string" ? " " + this.#options.text : "") + fullSuffixText;
          return this.#computeLineCountFrom(fullText, columns);
        }
      });
    }
  }
  get indent() {
    return this.#options.indent;
  }
  set indent(indent = 0) {
    if (!(indent >= 0 && Number.isInteger(indent))) {
      throw new Error("The `indent` option must be an integer from 0 and up");
    }
    this.#options.indent = indent;
  }
  get interval() {
    return this.#options.interval ?? this.#spinner.interval ?? 100;
  }
  get spinner() {
    return this.#spinner;
  }
  set spinner(spinner) {
    this.#frameIndex = -1;
    this.#options.interval = void 0;
    if (typeof spinner === "object") {
      if (!Array.isArray(spinner.frames) || spinner.frames.length === 0 || spinner.frames.some((frame) => typeof frame !== "string")) {
        throw new Error("The given spinner must have a non-empty `frames` array of strings");
      }
      if (spinner.interval !== void 0 && !(Number.isInteger(spinner.interval) && spinner.interval > 0)) {
        throw new Error("`spinner.interval` must be a positive integer if provided");
      }
      this.#spinner = spinner;
    } else if (!isUnicodeSupported()) {
      this.#spinner = cli_spinners_default.line;
    } else if (spinner === void 0) {
      this.#spinner = cli_spinners_default.dots;
    } else if (spinner !== "default" && cli_spinners_default[spinner]) {
      this.#spinner = cli_spinners_default[spinner];
    } else {
      throw new Error(`There is no built-in spinner named '${spinner}'. See https://github.com/sindresorhus/cli-spinners/blob/main/spinners.json for a full list.`);
    }
  }
  get text() {
    return this.#options.text;
  }
  set text(value = "") {
    this.#options.text = value;
  }
  get prefixText() {
    return this.#options.prefixText;
  }
  set prefixText(value = "") {
    this.#options.prefixText = value;
  }
  get suffixText() {
    return this.#options.suffixText;
  }
  set suffixText(value = "") {
    this.#options.suffixText = value;
  }
  get isSpinning() {
    return this.#id !== void 0;
  }
  #formatAffix(value, separator, placeBefore = false) {
    const resolved = typeof value === "function" ? value() : value;
    if (typeof resolved === "string" && resolved !== "") {
      return placeBefore ? separator + resolved : resolved + separator;
    }
    return "";
  }
  #getFullPrefixText(prefixText = this.#options.prefixText, postfix = " ") {
    return this.#formatAffix(prefixText, postfix, false);
  }
  #getFullSuffixText(suffixText = this.#options.suffixText, prefix = " ") {
    return this.#formatAffix(suffixText, prefix, true);
  }
  #computeLineCountFrom(text, columns) {
    let count = 0;
    for (const line of stripVTControlCharacters(text).split("\n")) {
      count += Math.max(1, Math.ceil(stringWidth(line) / columns));
    }
    return count;
  }
  get isEnabled() {
    return this.#options.isEnabled && !this.#options.isSilent;
  }
  set isEnabled(value) {
    if (typeof value !== "boolean") {
      throw new TypeError("The `isEnabled` option must be a boolean");
    }
    this.#options.isEnabled = value;
  }
  get isSilent() {
    return this.#options.isSilent;
  }
  set isSilent(value) {
    if (typeof value !== "boolean") {
      throw new TypeError("The `isSilent` option must be a boolean");
    }
    this.#options.isSilent = value;
  }
  frame() {
    const now = Date.now();
    if (this.#frameIndex === -1 || now - this.#lastFrameTime >= this.interval) {
      this.#frameIndex = (this.#frameIndex + 1) % this.#spinner.frames.length;
      this.#lastFrameTime = now;
    }
    const { frames } = this.#spinner;
    let frame = frames[this.#frameIndex];
    if (this.color) {
      frame = source_default[this.color](frame);
    }
    const fullPrefixText = this.#getFullPrefixText(this.#options.prefixText, " ");
    const fullText = typeof this.text === "string" ? " " + this.text : "";
    const fullSuffixText = this.#getFullSuffixText(this.#options.suffixText, " ");
    return fullPrefixText + frame + fullText + fullSuffixText;
  }
  clear() {
    if (!this.isEnabled || !this.#stream.isTTY) {
      return this;
    }
    this.#internalWrite(() => {
      this.#stream.cursorTo(0);
      for (let index = 0; index < this.#linesToClear; index++) {
        if (index > 0) {
          this.#stream.moveCursor(0, -1);
        }
        this.#stream.clearLine(1);
      }
      if (this.#options.indent) {
        this.#stream.cursorTo(this.#options.indent);
      }
    });
    this.#linesToClear = 0;
    return this;
  }
  // Helper to hook a single stream
  #hookStream(stream) {
    if (!stream || this.#hookedStreams.has(stream) || !stream.isTTY || typeof stream.write !== "function") {
      return;
    }
    if (activeHooksPerStream.has(stream)) {
      console.warn("[ora] Multiple concurrent spinners detected. This may cause visual corruption. Use one spinner at a time.");
    }
    const originalWrite = stream.write;
    this.#hookedStreams.set(stream, originalWrite);
    activeHooksPerStream.set(stream, this);
    stream.write = (chunk, encoding, callback) => this.#hookedWrite(stream, originalWrite, chunk, encoding, callback);
  }
  /**
  Intercept stream writes while spinner is active to handle external writes cleanly without visual corruption.
  Hooks process stdio streams and the active spinner stream so console.log(), console.error(), and direct writes stay tidy.
  */
  #installHook() {
    if (!this.isEnabled || this.#hookedStreams.size > 0) {
      return;
    }
    const streamsToHook = /* @__PURE__ */ new Set([this.#stream, process8.stdout, process8.stderr]);
    for (const stream of streamsToHook) {
      this.#hookStream(stream);
    }
  }
  #uninstallHook() {
    for (const [stream, originalWrite] of this.#hookedStreams) {
      stream.write = originalWrite;
      if (activeHooksPerStream.get(stream) === this) {
        activeHooksPerStream.delete(stream);
      }
    }
    this.#hookedStreams.clear();
  }
  // eslint-disable-next-line max-params -- Need stream and originalWrite for multi-stream support
  #hookedWrite(stream, originalWrite, chunk, encoding, callback) {
    if (typeof encoding === "function") {
      callback = encoding;
      encoding = void 0;
    }
    if (this.#isInternalWrite) {
      return originalWrite.call(stream, chunk, encoding, callback);
    }
    this.clear();
    const chunkString = this.#stringifyChunk(chunk, encoding);
    const chunkTerminatesLine = this.#chunkTerminatesLine(chunkString);
    const writeResult = originalWrite.call(stream, chunk, encoding, callback);
    if (chunkTerminatesLine) {
      this.#clearRenderDeferral();
    } else if (chunkString.length > 0) {
      this.#scheduleRenderDeferral();
    }
    if (this.isSpinning && !this.#deferRenderTimer) {
      this.render();
    }
    return writeResult;
  }
  render() {
    if (!this.isEnabled || this.#drainHandler || this.#deferRenderTimer) {
      return this;
    }
    const useSynchronizedOutput = this.#stream.isTTY;
    let shouldDisableSynchronizedOutput = false;
    try {
      if (useSynchronizedOutput) {
        this.#internalWrite(() => this.#stream.write(SYNCHRONIZED_OUTPUT_ENABLE));
        shouldDisableSynchronizedOutput = true;
      }
      this.clear();
      let frameContent = this.frame();
      const columns = this.#stream.columns ?? 80;
      const actualLineCount = this.#computeLineCountFrom(frameContent, columns);
      const consoleHeight = this.#stream.rows;
      if (consoleHeight && consoleHeight > 1 && actualLineCount > consoleHeight) {
        const lines = frameContent.split("\n");
        const maxLines = consoleHeight - 1;
        frameContent = [...lines.slice(0, maxLines), "... (content truncated to fit terminal)"].join("\n");
      }
      const canContinue = this.#internalWrite(() => this.#stream.write(frameContent));
      if (canContinue === false && this.#stream.isTTY) {
        this.#drainHandler = () => {
          this.#drainHandler = void 0;
          this.#tryRender();
        };
        this.#stream.once("drain", this.#drainHandler);
      }
      this.#linesToClear = this.#computeLineCountFrom(frameContent, columns);
    } finally {
      if (shouldDisableSynchronizedOutput) {
        this.#internalWrite(() => this.#stream.write(SYNCHRONIZED_OUTPUT_DISABLE));
      }
    }
    return this;
  }
  start(text) {
    if (text) {
      this.text = text;
    }
    if (this.isSilent) {
      return this;
    }
    if (!this.isEnabled) {
      const symbol = this.text ? "-" : "";
      const line = " ".repeat(this.#options.indent) + this.#buildOutputLine(symbol, this.text, this.#options.prefixText, this.#options.suffixText);
      if (line.trim() !== "") {
        this.#internalWrite(() => this.#stream.write(line + "\n"));
      }
      return this;
    }
    if (this.isSpinning) {
      return this;
    }
    if (this.#options.hideCursor) {
      cli_cursor_default.hide(this.#stream);
    }
    if (this.#options.discardStdin && process8.stdin.isTTY) {
      stdin_discarder_default.start();
      this.#isDiscardingStdin = true;
    }
    this.#installHook();
    this.render();
    this.#id = setInterval(this.render.bind(this), this.interval);
    return this;
  }
  stop() {
    clearInterval(this.#id);
    this.#id = void 0;
    this.#frameIndex = -1;
    this.#lastFrameTime = 0;
    this.#clearRenderDeferral();
    this.#uninstallHook();
    if (this.#drainHandler) {
      this.#stream.removeListener("drain", this.#drainHandler);
      this.#drainHandler = void 0;
    }
    if (this.isEnabled) {
      this.clear();
      if (this.#options.hideCursor) {
        cli_cursor_default.show(this.#stream);
      }
    }
    if (this.#isDiscardingStdin) {
      this.#isDiscardingStdin = false;
      stdin_discarder_default.stop();
    }
    return this;
  }
  succeed(text) {
    return this.stopAndPersist({ symbol: symbols_exports.success, text });
  }
  fail(text) {
    return this.stopAndPersist({ symbol: symbols_exports.error, text });
  }
  warn(text) {
    return this.stopAndPersist({ symbol: symbols_exports.warning, text });
  }
  info(text) {
    return this.stopAndPersist({ symbol: symbols_exports.info, text });
  }
  stopAndPersist(options = {}) {
    if (this.isSilent) {
      return this;
    }
    const symbol = options.symbol ?? " ";
    const text = options.text ?? this.text;
    const prefixText = options.prefixText ?? this.#options.prefixText;
    const suffixText = options.suffixText ?? this.#options.suffixText;
    const textToWrite = this.#buildOutputLine(symbol, text, prefixText, suffixText) + "\n";
    this.stop();
    this.#internalWrite(() => this.#stream.write(textToWrite));
    return this;
  }
};
function ora(options) {
  return new Ora(options);
}

// src/cli.ts
init_relay();

// src/version.ts
import { readFileSync as readFileSync3 } from "fs";
import { resolve as resolve2, dirname } from "path";
import { fileURLToPath } from "url";
function getVersion() {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolve2(thisDir, "..", "package.json");
  try {
    const pkg = JSON.parse(readFileSync3(pkgPath, "utf-8"));
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

// src/theme.ts
var theme = {
  // Status
  success: source_default.green,
  error: source_default.red,
  warning: source_default.yellow,
  info: source_default.cyan,
  hint: source_default.dim,
  // Typography
  bold: source_default.bold,
  heading: source_default.bold,
  label: source_default.bold.dim,
  // Branding
  brand: source_default.cyan.bold,
  version: source_default.dim,
  // Marks
  checkmark: source_default.green("\u2713"),
  crossmark: source_default.red("\u2717"),
  planned: source_default.dim("[planned]")
};
function banner(title) {
  const v = getVersion();
  return `  ${theme.brand("phone-a-friend")} ${theme.version(`v${v}`)} \u2014 ${theme.heading(title)}`;
}

// src/installer.ts
init_backends();
import { execFileSync as execFileSync5 } from "child_process";
import {
  existsSync as existsSync3,
  lstatSync,
  mkdirSync,
  realpathSync,
  rmSync as rmSync2,
  symlinkSync,
  cpSync,
  unlinkSync
} from "fs";
import { resolve as resolve3, join as join2, dirname as dirname2 } from "path";
import { homedir } from "os";
var PLUGIN_NAME = "phone-a-friend";
var MARKETPLACE_NAME = "phone-a-friend-dev";
var INSTALL_TARGETS = /* @__PURE__ */ new Set(["claude", "all"]);
var INSTALL_MODES = /* @__PURE__ */ new Set(["symlink", "copy"]);
var InstallerError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "InstallerError";
  }
};
function ensureParent(filePath) {
  mkdirSync(dirname2(filePath), { recursive: true });
}
function removePath(filePath) {
  let stat;
  try {
    stat = lstatSync(filePath);
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  if (stat.isSymbolicLink() || stat.isFile()) {
    unlinkSync(filePath);
  } else if (stat.isDirectory()) {
    rmSync2(filePath, { recursive: true, force: true });
  }
}
function installPath(src, dst, mode, force) {
  const dstExists = existsSync3(dst) || isSymlink(dst);
  if (dstExists) {
    if (isSymlink(dst) && realpathSync(dst) === realpathSync(src)) {
      return "already-installed";
    }
    if (!force) {
      throw new InstallerError(`Destination already exists: ${dst}`);
    }
    removePath(dst);
  }
  ensureParent(dst);
  if (mode === "symlink") {
    symlinkSync(src, dst);
  } else {
    cpSync(src, dst, { recursive: true });
  }
  return "installed";
}
function isSymlink(filePath) {
  try {
    return lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}
function runClaudeCommand(args) {
  try {
    const result = execFileSync5(args[0], args.slice(1), {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    });
    return { code: 0, output: result.trim() };
  } catch (err) {
    const execErr = err;
    const stdout = execErr.stdout?.toString() ?? "";
    const stderr = execErr.stderr?.toString() ?? "";
    return {
      code: execErr.status ?? 1,
      output: (stdout + stderr).trim()
    };
  }
}
function looksLikeOkIfAlready(output) {
  const text = output.toLowerCase();
  return [
    "already configured",
    "already added",
    "already installed",
    "already enabled",
    "already up to date"
  ].some((token) => text.includes(token));
}
function syncClaudePluginRegistration(repoRoot, marketplaceName = MARKETPLACE_NAME, pluginName = PLUGIN_NAME, scope = "user") {
  const lines = [];
  try {
    execFileSync5("which", ["claude"], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    lines.push("- claude_cli: skipped (claude binary not found)");
    return lines;
  }
  const commands = [
    [["claude", "plugin", "marketplace", "add", repoRoot], "marketplace_add"],
    [["claude", "plugin", "marketplace", "update", marketplaceName], "marketplace_update"],
    [["claude", "plugin", "install", `${pluginName}@${marketplaceName}`, "-s", scope], "install"],
    [["claude", "plugin", "enable", `${pluginName}@${marketplaceName}`, "-s", scope], "enable"],
    [["claude", "plugin", "update", `${pluginName}@${marketplaceName}`], "update"]
  ];
  for (const [cmd, label] of commands) {
    const { code, output } = runClaudeCommand(cmd);
    if (code === 0 || looksLikeOkIfAlready(output)) {
      lines.push(`- claude_cli_${label}: ok`);
    } else {
      lines.push(`- claude_cli_${label}: failed`);
      if (output) {
        lines.push(`  output: ${output}`);
      }
    }
  }
  return lines;
}
function claudeTarget(claudeHome) {
  const base = claudeHome ?? join2(homedir(), ".claude");
  return join2(base, "plugins", PLUGIN_NAME);
}
function installClaude(repoRoot, mode, force, claudeHome) {
  const target = claudeTarget(claudeHome);
  const status = installPath(repoRoot, target, mode, force);
  return { status, targetPath: target };
}
function uninstallPath(filePath) {
  if (existsSync3(filePath) || isSymlink(filePath)) {
    removePath(filePath);
    return "removed";
  }
  return "not-installed";
}
function uninstallClaude(claudeHome) {
  const target = claudeTarget(claudeHome);
  return { status: uninstallPath(target), targetPath: target };
}
function isValidRepoRoot(repoRoot) {
  return existsSync3(join2(repoRoot, ".claude-plugin", "plugin.json"));
}
function installHosts(opts) {
  const {
    repoRoot,
    target,
    mode = "symlink",
    force = false,
    claudeHome,
    syncClaudeCli = true
  } = opts;
  if (!INSTALL_TARGETS.has(target)) {
    throw new InstallerError(`Invalid target: ${target}`);
  }
  if (!INSTALL_MODES.has(mode)) {
    throw new InstallerError(`Invalid mode: ${mode}`);
  }
  const resolvedRepo = resolve3(repoRoot);
  if (!isValidRepoRoot(resolvedRepo)) {
    throw new InstallerError(`Invalid repo root: ${resolvedRepo}`);
  }
  const lines = [
    "phone-a-friend installer",
    `- repo_root: ${resolvedRepo}`,
    `- mode: ${mode}`
  ];
  const { status, targetPath } = installClaude(resolvedRepo, mode, force, claudeHome);
  lines.push(`- claude: ${status} -> ${targetPath}`);
  if (syncClaudeCli) {
    lines.push(...syncClaudePluginRegistration(resolvedRepo));
  }
  return lines;
}
function uninstallHosts(opts) {
  const { target, claudeHome } = opts;
  if (!INSTALL_TARGETS.has(target)) {
    throw new InstallerError(`Invalid target: ${target}`);
  }
  const lines = ["phone-a-friend uninstaller"];
  const { status, targetPath } = uninstallClaude(claudeHome);
  lines.push(`- claude: ${status} -> ${targetPath}`);
  return lines;
}
function verifyBackends() {
  const availability = checkBackends();
  return Object.entries(availability).map(([name, available]) => ({
    name,
    available,
    hint: INSTALL_HINTS[name] ?? ""
  }));
}

// node_modules/@inquirer/core/dist/lib/key.js
var isUpKey = (key, keybindings = []) => (
  // The up key
  key.name === "up" || // Vim keybinding: hjkl keys map to left/down/up/right
  keybindings.includes("vim") && key.name === "k" || // Emacs keybinding: Ctrl+P means "previous" in Emacs navigation conventions
  keybindings.includes("emacs") && key.ctrl && key.name === "p"
);
var isDownKey = (key, keybindings = []) => (
  // The down key
  key.name === "down" || // Vim keybinding: hjkl keys map to left/down/up/right
  keybindings.includes("vim") && key.name === "j" || // Emacs keybinding: Ctrl+N means "next" in Emacs navigation conventions
  keybindings.includes("emacs") && key.ctrl && key.name === "n"
);
var isBackspaceKey = (key) => key.name === "backspace";
var isTabKey = (key) => key.name === "tab";
var isNumberKey = (key) => "1234567890".includes(key.name);
var isEnterKey = (key) => key.name === "enter" || key.name === "return";

// node_modules/@inquirer/core/dist/lib/errors.js
var AbortPromptError = class extends Error {
  name = "AbortPromptError";
  message = "Prompt was aborted";
  constructor(options) {
    super();
    this.cause = options?.cause;
  }
};
var CancelPromptError = class extends Error {
  name = "CancelPromptError";
  message = "Prompt was canceled";
};
var ExitPromptError = class extends Error {
  name = "ExitPromptError";
};
var HookError = class extends Error {
  name = "HookError";
};
var ValidationError = class extends Error {
  name = "ValidationError";
};

// node_modules/@inquirer/core/dist/lib/use-state.js
import { AsyncResource as AsyncResource2 } from "async_hooks";

// node_modules/@inquirer/core/dist/lib/hook-engine.js
import { AsyncLocalStorage, AsyncResource } from "async_hooks";
var hookStorage = new AsyncLocalStorage();
function createStore(rl) {
  const store = {
    rl,
    hooks: [],
    hooksCleanup: [],
    hooksEffect: [],
    index: 0,
    handleChange() {
    }
  };
  return store;
}
function withHooks(rl, cb) {
  const store = createStore(rl);
  return hookStorage.run(store, () => {
    function cycle(render) {
      store.handleChange = () => {
        store.index = 0;
        render();
      };
      store.handleChange();
    }
    return cb(cycle);
  });
}
function getStore() {
  const store = hookStorage.getStore();
  if (!store) {
    throw new HookError("[Inquirer] Hook functions can only be called from within a prompt");
  }
  return store;
}
function readline() {
  return getStore().rl;
}
function withUpdates(fn) {
  const wrapped = (...args) => {
    const store = getStore();
    let shouldUpdate = false;
    const oldHandleChange = store.handleChange;
    store.handleChange = () => {
      shouldUpdate = true;
    };
    const returnValue = fn(...args);
    if (shouldUpdate) {
      oldHandleChange();
    }
    store.handleChange = oldHandleChange;
    return returnValue;
  };
  return AsyncResource.bind(wrapped);
}
function withPointer(cb) {
  const store = getStore();
  const { index } = store;
  const pointer = {
    get() {
      return store.hooks[index];
    },
    set(value) {
      store.hooks[index] = value;
    },
    initialized: index in store.hooks
  };
  const returnValue = cb(pointer);
  store.index++;
  return returnValue;
}
function handleChange() {
  getStore().handleChange();
}
var effectScheduler = {
  queue(cb) {
    const store = getStore();
    const { index } = store;
    store.hooksEffect.push(() => {
      store.hooksCleanup[index]?.();
      const cleanFn = cb(readline());
      if (cleanFn != null && typeof cleanFn !== "function") {
        throw new ValidationError("useEffect return value must be a cleanup function or nothing.");
      }
      store.hooksCleanup[index] = cleanFn;
    });
  },
  run() {
    const store = getStore();
    withUpdates(() => {
      store.hooksEffect.forEach((effect) => {
        effect();
      });
      store.hooksEffect.length = 0;
    })();
  },
  clearAll() {
    const store = getStore();
    store.hooksCleanup.forEach((cleanFn) => {
      cleanFn?.();
    });
    store.hooksEffect.length = 0;
    store.hooksCleanup.length = 0;
  }
};

// node_modules/@inquirer/core/dist/lib/use-state.js
function useState(defaultValue) {
  return withPointer((pointer) => {
    const setState = AsyncResource2.bind(function setState2(newValue) {
      if (pointer.get() !== newValue) {
        pointer.set(newValue);
        handleChange();
      }
    });
    if (pointer.initialized) {
      return [pointer.get(), setState];
    }
    const value = typeof defaultValue === "function" ? defaultValue() : defaultValue;
    pointer.set(value);
    return [value, setState];
  });
}

// node_modules/@inquirer/core/dist/lib/use-effect.js
function useEffect(cb, depArray) {
  withPointer((pointer) => {
    const oldDeps = pointer.get();
    const hasChanged = !Array.isArray(oldDeps) || depArray.some((dep, i) => !Object.is(dep, oldDeps[i]));
    if (hasChanged) {
      effectScheduler.queue(cb);
    }
    pointer.set(depArray);
  });
}

// node_modules/@inquirer/core/dist/lib/theme.js
import { styleText } from "util";

// node_modules/@inquirer/figures/dist/index.js
import process9 from "process";
function isUnicodeSupported2() {
  if (process9.platform !== "win32") {
    return process9.env["TERM"] !== "linux";
  }
  return Boolean(process9.env["WT_SESSION"]) || // Windows Terminal
  Boolean(process9.env["TERMINUS_SUBLIME"]) || // Terminus (<0.2.27)
  process9.env["ConEmuTask"] === "{cmd::Cmder}" || // ConEmu and cmder
  process9.env["TERM_PROGRAM"] === "Terminus-Sublime" || process9.env["TERM_PROGRAM"] === "vscode" || process9.env["TERM"] === "xterm-256color" || process9.env["TERM"] === "alacritty" || process9.env["TERMINAL_EMULATOR"] === "JetBrains-JediTerm";
}
var common = {
  circleQuestionMark: "(?)",
  questionMarkPrefix: "(?)",
  square: "\u2588",
  squareDarkShade: "\u2593",
  squareMediumShade: "\u2592",
  squareLightShade: "\u2591",
  squareTop: "\u2580",
  squareBottom: "\u2584",
  squareLeft: "\u258C",
  squareRight: "\u2590",
  squareCenter: "\u25A0",
  bullet: "\u25CF",
  dot: "\u2024",
  ellipsis: "\u2026",
  pointerSmall: "\u203A",
  triangleUp: "\u25B2",
  triangleUpSmall: "\u25B4",
  triangleDown: "\u25BC",
  triangleDownSmall: "\u25BE",
  triangleLeftSmall: "\u25C2",
  triangleRightSmall: "\u25B8",
  home: "\u2302",
  heart: "\u2665",
  musicNote: "\u266A",
  musicNoteBeamed: "\u266B",
  arrowUp: "\u2191",
  arrowDown: "\u2193",
  arrowLeft: "\u2190",
  arrowRight: "\u2192",
  arrowLeftRight: "\u2194",
  arrowUpDown: "\u2195",
  almostEqual: "\u2248",
  notEqual: "\u2260",
  lessOrEqual: "\u2264",
  greaterOrEqual: "\u2265",
  identical: "\u2261",
  infinity: "\u221E",
  subscriptZero: "\u2080",
  subscriptOne: "\u2081",
  subscriptTwo: "\u2082",
  subscriptThree: "\u2083",
  subscriptFour: "\u2084",
  subscriptFive: "\u2085",
  subscriptSix: "\u2086",
  subscriptSeven: "\u2087",
  subscriptEight: "\u2088",
  subscriptNine: "\u2089",
  oneHalf: "\xBD",
  oneThird: "\u2153",
  oneQuarter: "\xBC",
  oneFifth: "\u2155",
  oneSixth: "\u2159",
  oneEighth: "\u215B",
  twoThirds: "\u2154",
  twoFifths: "\u2156",
  threeQuarters: "\xBE",
  threeFifths: "\u2157",
  threeEighths: "\u215C",
  fourFifths: "\u2158",
  fiveSixths: "\u215A",
  fiveEighths: "\u215D",
  sevenEighths: "\u215E",
  line: "\u2500",
  lineBold: "\u2501",
  lineDouble: "\u2550",
  lineDashed0: "\u2504",
  lineDashed1: "\u2505",
  lineDashed2: "\u2508",
  lineDashed3: "\u2509",
  lineDashed4: "\u254C",
  lineDashed5: "\u254D",
  lineDashed6: "\u2574",
  lineDashed7: "\u2576",
  lineDashed8: "\u2578",
  lineDashed9: "\u257A",
  lineDashed10: "\u257C",
  lineDashed11: "\u257E",
  lineDashed12: "\u2212",
  lineDashed13: "\u2013",
  lineDashed14: "\u2010",
  lineDashed15: "\u2043",
  lineVertical: "\u2502",
  lineVerticalBold: "\u2503",
  lineVerticalDouble: "\u2551",
  lineVerticalDashed0: "\u2506",
  lineVerticalDashed1: "\u2507",
  lineVerticalDashed2: "\u250A",
  lineVerticalDashed3: "\u250B",
  lineVerticalDashed4: "\u254E",
  lineVerticalDashed5: "\u254F",
  lineVerticalDashed6: "\u2575",
  lineVerticalDashed7: "\u2577",
  lineVerticalDashed8: "\u2579",
  lineVerticalDashed9: "\u257B",
  lineVerticalDashed10: "\u257D",
  lineVerticalDashed11: "\u257F",
  lineDownLeft: "\u2510",
  lineDownLeftArc: "\u256E",
  lineDownBoldLeftBold: "\u2513",
  lineDownBoldLeft: "\u2512",
  lineDownLeftBold: "\u2511",
  lineDownDoubleLeftDouble: "\u2557",
  lineDownDoubleLeft: "\u2556",
  lineDownLeftDouble: "\u2555",
  lineDownRight: "\u250C",
  lineDownRightArc: "\u256D",
  lineDownBoldRightBold: "\u250F",
  lineDownBoldRight: "\u250E",
  lineDownRightBold: "\u250D",
  lineDownDoubleRightDouble: "\u2554",
  lineDownDoubleRight: "\u2553",
  lineDownRightDouble: "\u2552",
  lineUpLeft: "\u2518",
  lineUpLeftArc: "\u256F",
  lineUpBoldLeftBold: "\u251B",
  lineUpBoldLeft: "\u251A",
  lineUpLeftBold: "\u2519",
  lineUpDoubleLeftDouble: "\u255D",
  lineUpDoubleLeft: "\u255C",
  lineUpLeftDouble: "\u255B",
  lineUpRight: "\u2514",
  lineUpRightArc: "\u2570",
  lineUpBoldRightBold: "\u2517",
  lineUpBoldRight: "\u2516",
  lineUpRightBold: "\u2515",
  lineUpDoubleRightDouble: "\u255A",
  lineUpDoubleRight: "\u2559",
  lineUpRightDouble: "\u2558",
  lineUpDownLeft: "\u2524",
  lineUpBoldDownBoldLeftBold: "\u252B",
  lineUpBoldDownBoldLeft: "\u2528",
  lineUpDownLeftBold: "\u2525",
  lineUpBoldDownLeftBold: "\u2529",
  lineUpDownBoldLeftBold: "\u252A",
  lineUpDownBoldLeft: "\u2527",
  lineUpBoldDownLeft: "\u2526",
  lineUpDoubleDownDoubleLeftDouble: "\u2563",
  lineUpDoubleDownDoubleLeft: "\u2562",
  lineUpDownLeftDouble: "\u2561",
  lineUpDownRight: "\u251C",
  lineUpBoldDownBoldRightBold: "\u2523",
  lineUpBoldDownBoldRight: "\u2520",
  lineUpDownRightBold: "\u251D",
  lineUpBoldDownRightBold: "\u2521",
  lineUpDownBoldRightBold: "\u2522",
  lineUpDownBoldRight: "\u251F",
  lineUpBoldDownRight: "\u251E",
  lineUpDoubleDownDoubleRightDouble: "\u2560",
  lineUpDoubleDownDoubleRight: "\u255F",
  lineUpDownRightDouble: "\u255E",
  lineDownLeftRight: "\u252C",
  lineDownBoldLeftBoldRightBold: "\u2533",
  lineDownLeftBoldRightBold: "\u252F",
  lineDownBoldLeftRight: "\u2530",
  lineDownBoldLeftBoldRight: "\u2531",
  lineDownBoldLeftRightBold: "\u2532",
  lineDownLeftRightBold: "\u252E",
  lineDownLeftBoldRight: "\u252D",
  lineDownDoubleLeftDoubleRightDouble: "\u2566",
  lineDownDoubleLeftRight: "\u2565",
  lineDownLeftDoubleRightDouble: "\u2564",
  lineUpLeftRight: "\u2534",
  lineUpBoldLeftBoldRightBold: "\u253B",
  lineUpLeftBoldRightBold: "\u2537",
  lineUpBoldLeftRight: "\u2538",
  lineUpBoldLeftBoldRight: "\u2539",
  lineUpBoldLeftRightBold: "\u253A",
  lineUpLeftRightBold: "\u2536",
  lineUpLeftBoldRight: "\u2535",
  lineUpDoubleLeftDoubleRightDouble: "\u2569",
  lineUpDoubleLeftRight: "\u2568",
  lineUpLeftDoubleRightDouble: "\u2567",
  lineUpDownLeftRight: "\u253C",
  lineUpBoldDownBoldLeftBoldRightBold: "\u254B",
  lineUpDownBoldLeftBoldRightBold: "\u2548",
  lineUpBoldDownLeftBoldRightBold: "\u2547",
  lineUpBoldDownBoldLeftRightBold: "\u254A",
  lineUpBoldDownBoldLeftBoldRight: "\u2549",
  lineUpBoldDownLeftRight: "\u2540",
  lineUpDownBoldLeftRight: "\u2541",
  lineUpDownLeftBoldRight: "\u253D",
  lineUpDownLeftRightBold: "\u253E",
  lineUpBoldDownBoldLeftRight: "\u2542",
  lineUpDownLeftBoldRightBold: "\u253F",
  lineUpBoldDownLeftBoldRight: "\u2543",
  lineUpBoldDownLeftRightBold: "\u2544",
  lineUpDownBoldLeftBoldRight: "\u2545",
  lineUpDownBoldLeftRightBold: "\u2546",
  lineUpDoubleDownDoubleLeftDoubleRightDouble: "\u256C",
  lineUpDoubleDownDoubleLeftRight: "\u256B",
  lineUpDownLeftDoubleRightDouble: "\u256A",
  lineCross: "\u2573",
  lineBackslash: "\u2572",
  lineSlash: "\u2571"
};
var specialMainSymbols = {
  tick: "\u2714",
  info: "\u2139",
  warning: "\u26A0",
  cross: "\u2718",
  squareSmall: "\u25FB",
  squareSmallFilled: "\u25FC",
  circle: "\u25EF",
  circleFilled: "\u25C9",
  circleDotted: "\u25CC",
  circleDouble: "\u25CE",
  circleCircle: "\u24DE",
  circleCross: "\u24E7",
  circlePipe: "\u24BE",
  radioOn: "\u25C9",
  radioOff: "\u25EF",
  checkboxOn: "\u2612",
  checkboxOff: "\u2610",
  checkboxCircleOn: "\u24E7",
  checkboxCircleOff: "\u24BE",
  pointer: "\u276F",
  triangleUpOutline: "\u25B3",
  triangleLeft: "\u25C0",
  triangleRight: "\u25B6",
  lozenge: "\u25C6",
  lozengeOutline: "\u25C7",
  hamburger: "\u2630",
  smiley: "\u32E1",
  mustache: "\u0DF4",
  star: "\u2605",
  play: "\u25B6",
  nodejs: "\u2B22",
  oneSeventh: "\u2150",
  oneNinth: "\u2151",
  oneTenth: "\u2152"
};
var specialFallbackSymbols = {
  tick: "\u221A",
  info: "i",
  warning: "\u203C",
  cross: "\xD7",
  squareSmall: "\u25A1",
  squareSmallFilled: "\u25A0",
  circle: "( )",
  circleFilled: "(*)",
  circleDotted: "( )",
  circleDouble: "( )",
  circleCircle: "(\u25CB)",
  circleCross: "(\xD7)",
  circlePipe: "(\u2502)",
  radioOn: "(*)",
  radioOff: "( )",
  checkboxOn: "[\xD7]",
  checkboxOff: "[ ]",
  checkboxCircleOn: "(\xD7)",
  checkboxCircleOff: "( )",
  pointer: ">",
  triangleUpOutline: "\u2206",
  triangleLeft: "\u25C4",
  triangleRight: "\u25BA",
  lozenge: "\u2666",
  lozengeOutline: "\u25CA",
  hamburger: "\u2261",
  smiley: "\u263A",
  mustache: "\u250C\u2500\u2510",
  star: "\u2736",
  play: "\u25BA",
  nodejs: "\u2666",
  oneSeventh: "1/7",
  oneNinth: "1/9",
  oneTenth: "1/10"
};
var mainSymbols = {
  ...common,
  ...specialMainSymbols
};
var fallbackSymbols = {
  ...common,
  ...specialFallbackSymbols
};
var shouldUseMain = isUnicodeSupported2();
var figures = shouldUseMain ? mainSymbols : fallbackSymbols;
var dist_default = figures;
var replacements = Object.entries(specialMainSymbols);

// node_modules/@inquirer/core/dist/lib/theme.js
var defaultTheme = {
  prefix: {
    idle: styleText("blue", "?"),
    done: styleText("green", dist_default.tick)
  },
  spinner: {
    interval: 80,
    frames: ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"].map((frame) => styleText("yellow", frame))
  },
  style: {
    answer: (text) => styleText("cyan", text),
    message: (text) => styleText("bold", text),
    error: (text) => styleText("red", `> ${text}`),
    defaultAnswer: (text) => styleText("dim", `(${text})`),
    help: (text) => styleText("dim", text),
    highlight: (text) => styleText("cyan", text),
    key: (text) => styleText("cyan", styleText("bold", `<${text}>`))
  }
};

// node_modules/@inquirer/core/dist/lib/make-theme.js
function isPlainObject(value) {
  if (typeof value !== "object" || value === null)
    return false;
  let proto2 = value;
  while (Object.getPrototypeOf(proto2) !== null) {
    proto2 = Object.getPrototypeOf(proto2);
  }
  return Object.getPrototypeOf(value) === proto2;
}
function deepMerge(...objects) {
  const output = {};
  for (const obj of objects) {
    for (const [key, value] of Object.entries(obj)) {
      const prevValue = output[key];
      output[key] = isPlainObject(prevValue) && isPlainObject(value) ? deepMerge(prevValue, value) : value;
    }
  }
  return output;
}
function makeTheme(...themes) {
  const themesToMerge = [
    defaultTheme,
    ...themes.filter((theme2) => theme2 != null)
  ];
  return deepMerge(...themesToMerge);
}

// node_modules/@inquirer/core/dist/lib/use-prefix.js
function usePrefix({ status = "idle", theme: theme2 }) {
  const [showLoader, setShowLoader] = useState(false);
  const [tick, setTick] = useState(0);
  const { prefix, spinner } = makeTheme(theme2);
  useEffect(() => {
    if (status === "loading") {
      let tickInterval;
      let inc = -1;
      const delayTimeout = setTimeout(() => {
        setShowLoader(true);
        tickInterval = setInterval(() => {
          inc = inc + 1;
          setTick(inc % spinner.frames.length);
        }, spinner.interval);
      }, 300);
      return () => {
        clearTimeout(delayTimeout);
        clearInterval(tickInterval);
      };
    } else {
      setShowLoader(false);
    }
  }, [status]);
  if (showLoader) {
    return spinner.frames[tick];
  }
  const iconName = status === "loading" ? "idle" : status;
  return typeof prefix === "string" ? prefix : prefix[iconName] ?? prefix["idle"];
}

// node_modules/@inquirer/core/dist/lib/use-memo.js
function useMemo(fn, dependencies) {
  return withPointer((pointer) => {
    const prev = pointer.get();
    if (!prev || prev.dependencies.length !== dependencies.length || prev.dependencies.some((dep, i) => dep !== dependencies[i])) {
      const value = fn();
      pointer.set({ value, dependencies });
      return value;
    }
    return prev.value;
  });
}

// node_modules/@inquirer/core/dist/lib/use-ref.js
function useRef(val) {
  return useState({ current: val })[0];
}

// node_modules/@inquirer/core/dist/lib/use-keypress.js
function useKeypress(userHandler) {
  const signal = useRef(userHandler);
  signal.current = userHandler;
  useEffect((rl) => {
    let ignore = false;
    const handler = withUpdates((_input, event) => {
      if (ignore)
        return;
      void signal.current(event, rl);
    });
    rl.input.on("keypress", handler);
    return () => {
      ignore = true;
      rl.input.removeListener("keypress", handler);
    };
  }, []);
}

// node_modules/@inquirer/core/dist/lib/utils.js
var import_cli_width = __toESM(require_cli_width(), 1);

// node_modules/fast-string-truncated-width/dist/utils.js
var getCodePointsLength = /* @__PURE__ */ (() => {
  const SURROGATE_PAIR_RE = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;
  return (input) => {
    let surrogatePairsNr = 0;
    SURROGATE_PAIR_RE.lastIndex = 0;
    while (SURROGATE_PAIR_RE.test(input)) {
      surrogatePairsNr += 1;
    }
    return input.length - surrogatePairsNr;
  };
})();
var isFullWidth2 = (x) => {
  return x === 12288 || x >= 65281 && x <= 65376 || x >= 65504 && x <= 65510;
};
var isWideNotCJKTNotEmoji = (x) => {
  return x === 8987 || x === 9001 || x >= 12272 && x <= 12287 || x >= 12289 && x <= 12350 || x >= 12441 && x <= 12543 || x >= 12549 && x <= 12591 || x >= 12593 && x <= 12686 || x >= 12688 && x <= 12771 || x >= 12783 && x <= 12830 || x >= 12832 && x <= 12871 || x >= 12880 && x <= 19903 || x >= 65040 && x <= 65049 || x >= 65072 && x <= 65106 || x >= 65108 && x <= 65126 || x >= 65128 && x <= 65131 || x >= 127488 && x <= 127490 || x >= 127504 && x <= 127547 || x >= 127552 && x <= 127560 || x >= 131072 && x <= 196605 || x >= 196608 && x <= 262141;
};

// node_modules/fast-string-truncated-width/dist/index.js
var ANSI_RE = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]|\u001b\]8;[^;]*;.*?(?:\u0007|\u001b\u005c)/y;
var CONTROL_RE = /[\x00-\x08\x0A-\x1F\x7F-\x9F]{1,1000}/y;
var CJKT_WIDE_RE = /(?:(?![\uFF61-\uFF9F\uFF00-\uFFEF])[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Tangut}]){1,1000}/yu;
var TAB_RE = /\t{1,1000}/y;
var EMOJI_RE = /[\u{1F1E6}-\u{1F1FF}]{2}|\u{1F3F4}[\u{E0061}-\u{E007A}]{2}[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]{1,3}\u{E007F}|(?:\p{Emoji}\uFE0F\u20E3?|\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|\p{Emoji_Presentation})(?:\u200D(?:\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|\p{Emoji_Presentation}|\p{Emoji}\uFE0F\u20E3?))*/yu;
var LATIN_RE = /(?:[\x20-\x7E\xA0-\xFF](?!\uFE0F)){1,1000}/y;
var MODIFIER_RE = /\p{M}+/gu;
var NO_TRUNCATION = { limit: Infinity, ellipsis: "" };
var getStringTruncatedWidth = (input, truncationOptions = {}, widthOptions = {}) => {
  const LIMIT = truncationOptions.limit ?? Infinity;
  const ELLIPSIS = truncationOptions.ellipsis ?? "";
  const ELLIPSIS_WIDTH = truncationOptions?.ellipsisWidth ?? (ELLIPSIS ? getStringTruncatedWidth(ELLIPSIS, NO_TRUNCATION, widthOptions).width : 0);
  const ANSI_WIDTH = 0;
  const CONTROL_WIDTH = widthOptions.controlWidth ?? 0;
  const TAB_WIDTH = widthOptions.tabWidth ?? 8;
  const EMOJI_WIDTH = widthOptions.emojiWidth ?? 2;
  const FULL_WIDTH_WIDTH = 2;
  const REGULAR_WIDTH = widthOptions.regularWidth ?? 1;
  const WIDE_WIDTH = widthOptions.wideWidth ?? FULL_WIDTH_WIDTH;
  const PARSE_BLOCKS = [
    [LATIN_RE, REGULAR_WIDTH],
    [ANSI_RE, ANSI_WIDTH],
    [CONTROL_RE, CONTROL_WIDTH],
    [TAB_RE, TAB_WIDTH],
    [EMOJI_RE, EMOJI_WIDTH],
    [CJKT_WIDE_RE, WIDE_WIDTH]
  ];
  let indexPrev = 0;
  let index = 0;
  let length = input.length;
  let lengthExtra = 0;
  let truncationEnabled = false;
  let truncationIndex = length;
  let truncationLimit = Math.max(0, LIMIT - ELLIPSIS_WIDTH);
  let unmatchedStart = 0;
  let unmatchedEnd = 0;
  let width = 0;
  let widthExtra = 0;
  outer: while (true) {
    if (unmatchedEnd > unmatchedStart || index >= length && index > indexPrev) {
      const unmatched = input.slice(unmatchedStart, unmatchedEnd) || input.slice(indexPrev, index);
      lengthExtra = 0;
      for (const char of unmatched.replaceAll(MODIFIER_RE, "")) {
        const codePoint = char.codePointAt(0) || 0;
        if (isFullWidth2(codePoint)) {
          widthExtra = FULL_WIDTH_WIDTH;
        } else if (isWideNotCJKTNotEmoji(codePoint)) {
          widthExtra = WIDE_WIDTH;
        } else {
          widthExtra = REGULAR_WIDTH;
        }
        if (width + widthExtra > truncationLimit) {
          truncationIndex = Math.min(truncationIndex, Math.max(unmatchedStart, indexPrev) + lengthExtra);
        }
        if (width + widthExtra > LIMIT) {
          truncationEnabled = true;
          break outer;
        }
        lengthExtra += char.length;
        width += widthExtra;
      }
      unmatchedStart = unmatchedEnd = 0;
    }
    if (index >= length) {
      break outer;
    }
    for (let i = 0, l = PARSE_BLOCKS.length; i < l; i++) {
      const [BLOCK_RE, BLOCK_WIDTH] = PARSE_BLOCKS[i];
      BLOCK_RE.lastIndex = index;
      if (BLOCK_RE.test(input)) {
        lengthExtra = BLOCK_RE === CJKT_WIDE_RE ? getCodePointsLength(input.slice(index, BLOCK_RE.lastIndex)) : BLOCK_RE === EMOJI_RE ? 1 : BLOCK_RE.lastIndex - index;
        widthExtra = lengthExtra * BLOCK_WIDTH;
        if (width + widthExtra > truncationLimit) {
          truncationIndex = Math.min(truncationIndex, index + Math.floor((truncationLimit - width) / BLOCK_WIDTH));
        }
        if (width + widthExtra > LIMIT) {
          truncationEnabled = true;
          break outer;
        }
        width += widthExtra;
        unmatchedStart = indexPrev;
        unmatchedEnd = index;
        index = indexPrev = BLOCK_RE.lastIndex;
        continue outer;
      }
    }
    index += 1;
  }
  return {
    width: truncationEnabled ? truncationLimit : width,
    index: truncationEnabled ? truncationIndex : length,
    truncated: truncationEnabled,
    ellipsed: truncationEnabled && LIMIT >= ELLIPSIS_WIDTH
  };
};
var dist_default2 = getStringTruncatedWidth;

// node_modules/fast-string-width/dist/index.js
var NO_TRUNCATION2 = {
  limit: Infinity,
  ellipsis: "",
  ellipsisWidth: 0
};
var fastStringWidth = (input, options = {}) => {
  return dist_default2(input, NO_TRUNCATION2, options).width;
};
var dist_default3 = fastStringWidth;

// node_modules/fast-wrap-ansi/lib/main.js
var ESC = "\x1B";
var CSI = "\x9B";
var END_CODE = 39;
var ANSI_ESCAPE_BELL = "\x07";
var ANSI_CSI = "[";
var ANSI_OSC = "]";
var ANSI_SGR_TERMINATOR = "m";
var ANSI_ESCAPE_LINK = `${ANSI_OSC}8;;`;
var GROUP_REGEX = new RegExp(`(?:\\${ANSI_CSI}(?<code>\\d+)m|\\${ANSI_ESCAPE_LINK}(?<uri>.*)${ANSI_ESCAPE_BELL})`, "y");
var getClosingCode = (openingCode) => {
  if (openingCode >= 30 && openingCode <= 37)
    return 39;
  if (openingCode >= 90 && openingCode <= 97)
    return 39;
  if (openingCode >= 40 && openingCode <= 47)
    return 49;
  if (openingCode >= 100 && openingCode <= 107)
    return 49;
  if (openingCode === 1 || openingCode === 2)
    return 22;
  if (openingCode === 3)
    return 23;
  if (openingCode === 4)
    return 24;
  if (openingCode === 7)
    return 27;
  if (openingCode === 8)
    return 28;
  if (openingCode === 9)
    return 29;
  if (openingCode === 0)
    return 0;
  return void 0;
};
var wrapAnsiCode = (code) => `${ESC}${ANSI_CSI}${code}${ANSI_SGR_TERMINATOR}`;
var wrapAnsiHyperlink = (url) => `${ESC}${ANSI_ESCAPE_LINK}${url}${ANSI_ESCAPE_BELL}`;
var wrapWord = (rows, word, columns) => {
  const characters = word[Symbol.iterator]();
  let isInsideEscape = false;
  let isInsideLinkEscape = false;
  let lastRow = rows.at(-1);
  let visible = lastRow === void 0 ? 0 : dist_default3(lastRow);
  let currentCharacter = characters.next();
  let nextCharacter = characters.next();
  let rawCharacterIndex = 0;
  while (!currentCharacter.done) {
    const character = currentCharacter.value;
    const characterLength = dist_default3(character);
    if (visible + characterLength <= columns) {
      rows[rows.length - 1] += character;
    } else {
      rows.push(character);
      visible = 0;
    }
    if (character === ESC || character === CSI) {
      isInsideEscape = true;
      isInsideLinkEscape = word.startsWith(ANSI_ESCAPE_LINK, rawCharacterIndex + 1);
    }
    if (isInsideEscape) {
      if (isInsideLinkEscape) {
        if (character === ANSI_ESCAPE_BELL) {
          isInsideEscape = false;
          isInsideLinkEscape = false;
        }
      } else if (character === ANSI_SGR_TERMINATOR) {
        isInsideEscape = false;
      }
    } else {
      visible += characterLength;
      if (visible === columns && !nextCharacter.done) {
        rows.push("");
        visible = 0;
      }
    }
    currentCharacter = nextCharacter;
    nextCharacter = characters.next();
    rawCharacterIndex += character.length;
  }
  lastRow = rows.at(-1);
  if (!visible && lastRow !== void 0 && lastRow.length && rows.length > 1) {
    rows[rows.length - 2] += rows.pop();
  }
};
var stringVisibleTrimSpacesRight = (string) => {
  const words = string.split(" ");
  let last = words.length;
  while (last) {
    if (dist_default3(words[last - 1])) {
      break;
    }
    last--;
  }
  if (last === words.length) {
    return string;
  }
  return words.slice(0, last).join(" ") + words.slice(last).join("");
};
var exec = (string, columns, options = {}) => {
  if (options.trim !== false && string.trim() === "") {
    return "";
  }
  let returnValue = "";
  let escapeCode;
  let escapeUrl;
  const words = string.split(" ");
  let rows = [""];
  let rowLength = 0;
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    if (options.trim !== false) {
      const row = rows.at(-1) ?? "";
      const trimmed = row.trimStart();
      if (row.length !== trimmed.length) {
        rows[rows.length - 1] = trimmed;
        rowLength = dist_default3(trimmed);
      }
    }
    if (index !== 0) {
      if (rowLength >= columns && (options.wordWrap === false || options.trim === false)) {
        rows.push("");
        rowLength = 0;
      }
      if (rowLength || options.trim === false) {
        rows[rows.length - 1] += " ";
        rowLength++;
      }
    }
    const wordLength = dist_default3(word);
    if (options.hard && wordLength > columns) {
      const remainingColumns = columns - rowLength;
      const breaksStartingThisLine = 1 + Math.floor((wordLength - remainingColumns - 1) / columns);
      const breaksStartingNextLine = Math.floor((wordLength - 1) / columns);
      if (breaksStartingNextLine < breaksStartingThisLine) {
        rows.push("");
      }
      wrapWord(rows, word, columns);
      rowLength = dist_default3(rows.at(-1) ?? "");
      continue;
    }
    if (rowLength + wordLength > columns && rowLength && wordLength) {
      if (options.wordWrap === false && rowLength < columns) {
        wrapWord(rows, word, columns);
        rowLength = dist_default3(rows.at(-1) ?? "");
        continue;
      }
      rows.push("");
      rowLength = 0;
    }
    if (rowLength + wordLength > columns && options.wordWrap === false) {
      wrapWord(rows, word, columns);
      rowLength = dist_default3(rows.at(-1) ?? "");
      continue;
    }
    rows[rows.length - 1] += word;
    rowLength += wordLength;
  }
  if (options.trim !== false) {
    rows = rows.map((row) => stringVisibleTrimSpacesRight(row));
  }
  const preString = rows.join("\n");
  let inSurrogate = false;
  for (let i = 0; i < preString.length; i++) {
    const character = preString[i];
    returnValue += character;
    if (!inSurrogate) {
      inSurrogate = character >= "\uD800" && character <= "\uDBFF";
      if (inSurrogate) {
        continue;
      }
    } else {
      inSurrogate = false;
    }
    if (character === ESC || character === CSI) {
      GROUP_REGEX.lastIndex = i + 1;
      const groupsResult = GROUP_REGEX.exec(preString);
      const groups = groupsResult?.groups;
      if (groups?.code !== void 0) {
        const code = Number.parseFloat(groups.code);
        escapeCode = code === END_CODE ? void 0 : code;
      } else if (groups?.uri !== void 0) {
        escapeUrl = groups.uri.length === 0 ? void 0 : groups.uri;
      }
    }
    if (preString[i + 1] === "\n") {
      if (escapeUrl) {
        returnValue += wrapAnsiHyperlink("");
      }
      const closingCode = escapeCode ? getClosingCode(escapeCode) : void 0;
      if (escapeCode && closingCode) {
        returnValue += wrapAnsiCode(closingCode);
      }
    } else if (character === "\n") {
      if (escapeCode && getClosingCode(escapeCode)) {
        returnValue += wrapAnsiCode(escapeCode);
      }
      if (escapeUrl) {
        returnValue += wrapAnsiHyperlink(escapeUrl);
      }
    }
  }
  return returnValue;
};
var CRLF_OR_LF = /\r?\n/;
function wrapAnsi(string, columns, options) {
  return String(string).normalize().split(CRLF_OR_LF).map((line) => exec(line, columns, options)).join("\n");
}

// node_modules/@inquirer/core/dist/lib/utils.js
function breakLines(content, width) {
  return content.split("\n").flatMap((line) => wrapAnsi(line, width, { trim: false, hard: true }).split("\n").map((str) => str.trimEnd())).join("\n");
}
function readlineWidth() {
  return (0, import_cli_width.default)({ defaultWidth: 80, output: readline().output });
}

// node_modules/@inquirer/core/dist/lib/pagination/use-pagination.js
function usePointerPosition({ active, renderedItems, pageSize, loop }) {
  const state = useRef({
    lastPointer: active,
    lastActive: void 0
  });
  const { lastPointer, lastActive } = state.current;
  const middle = Math.floor(pageSize / 2);
  const renderedLength = renderedItems.reduce((acc, item) => acc + item.length, 0);
  const defaultPointerPosition = renderedItems.slice(0, active).reduce((acc, item) => acc + item.length, 0);
  let pointer = defaultPointerPosition;
  if (renderedLength > pageSize) {
    if (loop) {
      pointer = lastPointer;
      if (
        // First render, skip this logic.
        lastActive != null && // Only move the pointer down when the user moves down.
        lastActive < active && // Check user didn't move up across page boundary.
        active - lastActive < pageSize
      ) {
        pointer = Math.min(
          // Furthest allowed position for the pointer is the middle of the list
          middle,
          Math.abs(active - lastActive) === 1 ? Math.min(
            // Move the pointer at most the height of the last active item.
            lastPointer + (renderedItems[lastActive]?.length ?? 0),
            // If the user moved by one item, move the pointer to the natural position of the active item as
            // long as it doesn't move the cursor up.
            Math.max(defaultPointerPosition, lastPointer)
          ) : (
            // Otherwise, move the pointer down by the difference between the active and last active item.
            lastPointer + active - lastActive
          )
        );
      }
    } else {
      const spaceUnderActive = renderedItems.slice(active).reduce((acc, item) => acc + item.length, 0);
      pointer = spaceUnderActive < pageSize - middle ? (
        // If the active item is near the end of the list, progressively move the cursor towards the end.
        pageSize - spaceUnderActive
      ) : (
        // Otherwise, progressively move the pointer to the middle of the list.
        Math.min(defaultPointerPosition, middle)
      );
    }
  }
  state.current.lastPointer = pointer;
  state.current.lastActive = active;
  return pointer;
}
function usePagination({ items, active, renderItem, pageSize, loop = true }) {
  const width = readlineWidth();
  const bound = (num) => (num % items.length + items.length) % items.length;
  const renderedItems = items.map((item, index) => {
    if (item == null)
      return [];
    return breakLines(renderItem({ item, index, isActive: index === active }), width).split("\n");
  });
  const renderedLength = renderedItems.reduce((acc, item) => acc + item.length, 0);
  const renderItemAtIndex = (index) => renderedItems[index] ?? [];
  const pointer = usePointerPosition({ active, renderedItems, pageSize, loop });
  const activeItem = renderItemAtIndex(active).slice(0, pageSize);
  const activeItemPosition = pointer + activeItem.length <= pageSize ? pointer : pageSize - activeItem.length;
  const pageBuffer = Array.from({ length: pageSize });
  pageBuffer.splice(activeItemPosition, activeItem.length, ...activeItem);
  const itemVisited = /* @__PURE__ */ new Set([active]);
  let bufferPointer = activeItemPosition + activeItem.length;
  let itemPointer = bound(active + 1);
  while (bufferPointer < pageSize && !itemVisited.has(itemPointer) && (loop && renderedLength > pageSize ? itemPointer !== active : itemPointer > active)) {
    const lines = renderItemAtIndex(itemPointer);
    const linesToAdd = lines.slice(0, pageSize - bufferPointer);
    pageBuffer.splice(bufferPointer, linesToAdd.length, ...linesToAdd);
    itemVisited.add(itemPointer);
    bufferPointer += linesToAdd.length;
    itemPointer = bound(itemPointer + 1);
  }
  bufferPointer = activeItemPosition - 1;
  itemPointer = bound(active - 1);
  while (bufferPointer >= 0 && !itemVisited.has(itemPointer) && (loop && renderedLength > pageSize ? itemPointer !== active : itemPointer < active)) {
    const lines = renderItemAtIndex(itemPointer);
    const linesToAdd = lines.slice(Math.max(0, lines.length - bufferPointer - 1));
    pageBuffer.splice(bufferPointer - linesToAdd.length + 1, linesToAdd.length, ...linesToAdd);
    itemVisited.add(itemPointer);
    bufferPointer -= linesToAdd.length;
    itemPointer = bound(itemPointer - 1);
  }
  return pageBuffer.filter((line) => typeof line === "string").join("\n");
}

// node_modules/@inquirer/core/dist/lib/create-prompt.js
var import_mute_stream = __toESM(require_lib(), 1);
import * as readline2 from "readline";
import { AsyncResource as AsyncResource3 } from "async_hooks";

// node_modules/@inquirer/core/dist/lib/screen-manager.js
import { stripVTControlCharacters as stripVTControlCharacters2 } from "util";

// node_modules/@inquirer/ansi/dist/index.js
var ESC2 = "\x1B[";
var cursorLeft = ESC2 + "G";
var cursorHide = ESC2 + "?25l";
var cursorShow = ESC2 + "?25h";
var cursorUp = (rows = 1) => rows > 0 ? `${ESC2}${rows}A` : "";
var cursorDown = (rows = 1) => rows > 0 ? `${ESC2}${rows}B` : "";
var cursorTo = (x, y) => {
  if (typeof y === "number" && !Number.isNaN(y)) {
    return `${ESC2}${y + 1};${x + 1}H`;
  }
  return `${ESC2}${x + 1}G`;
};
var eraseLine = ESC2 + "2K";
var eraseLines = (lines) => lines > 0 ? (eraseLine + cursorUp(1)).repeat(lines - 1) + eraseLine + cursorLeft : "";

// node_modules/@inquirer/core/dist/lib/screen-manager.js
var height = (content) => content.split("\n").length;
var lastLine = (content) => content.split("\n").pop() ?? "";
var ScreenManager = class {
  // These variables are keeping information to allow correct prompt re-rendering
  height = 0;
  extraLinesUnderPrompt = 0;
  cursorPos;
  rl;
  constructor(rl) {
    this.rl = rl;
    this.cursorPos = rl.getCursorPos();
  }
  write(content) {
    this.rl.output.unmute();
    this.rl.output.write(content);
    this.rl.output.mute();
  }
  render(content, bottomContent = "") {
    const promptLine = lastLine(content);
    const rawPromptLine = stripVTControlCharacters2(promptLine);
    let prompt = rawPromptLine;
    if (this.rl.line.length > 0) {
      prompt = prompt.slice(0, -this.rl.line.length);
    }
    this.rl.setPrompt(prompt);
    this.cursorPos = this.rl.getCursorPos();
    const width = readlineWidth();
    content = breakLines(content, width);
    bottomContent = breakLines(bottomContent, width);
    if (rawPromptLine.length % width === 0) {
      content += "\n";
    }
    let output = content + (bottomContent ? "\n" + bottomContent : "");
    const promptLineUpDiff = Math.floor(rawPromptLine.length / width) - this.cursorPos.rows;
    const bottomContentHeight = promptLineUpDiff + (bottomContent ? height(bottomContent) : 0);
    if (bottomContentHeight > 0)
      output += cursorUp(bottomContentHeight);
    output += cursorTo(this.cursorPos.cols);
    this.write(cursorDown(this.extraLinesUnderPrompt) + eraseLines(this.height) + output);
    this.extraLinesUnderPrompt = bottomContentHeight;
    this.height = height(output);
  }
  checkCursorPos() {
    const cursorPos = this.rl.getCursorPos();
    if (cursorPos.cols !== this.cursorPos.cols) {
      this.write(cursorTo(cursorPos.cols));
      this.cursorPos = cursorPos;
    }
  }
  done({ clearContent }) {
    this.rl.setPrompt("");
    let output = cursorDown(this.extraLinesUnderPrompt);
    output += clearContent ? eraseLines(this.height) : "\n";
    output += cursorShow;
    this.write(output);
    this.rl.close();
  }
};

// node_modules/@inquirer/core/dist/lib/promise-polyfill.js
var PromisePolyfill = class extends Promise {
  // Available starting from Node 22
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/withResolvers
  static withResolver() {
    let resolve5;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve5 = res;
      reject = rej;
    });
    return { promise, resolve: resolve5, reject };
  }
};

// node_modules/@inquirer/core/dist/lib/create-prompt.js
function getCallSites() {
  const _prepareStackTrace = Error.prepareStackTrace;
  let result = [];
  try {
    Error.prepareStackTrace = (_, callSites) => {
      const callSitesWithoutCurrent = callSites.slice(1);
      result = callSitesWithoutCurrent;
      return callSitesWithoutCurrent;
    };
    new Error().stack;
  } catch {
    return result;
  }
  Error.prepareStackTrace = _prepareStackTrace;
  return result;
}
function createPrompt(view) {
  const callSites = getCallSites();
  const prompt = (config, context = {}) => {
    const { input = process.stdin, signal } = context;
    const cleanups = /* @__PURE__ */ new Set();
    const output = new import_mute_stream.default();
    output.pipe(context.output ?? process.stdout);
    const rl = readline2.createInterface({
      terminal: true,
      input,
      output
    });
    const screen = new ScreenManager(rl);
    const { promise, resolve: resolve5, reject } = PromisePolyfill.withResolver();
    const cancel = () => reject(new CancelPromptError());
    if (signal) {
      const abort = () => reject(new AbortPromptError({ cause: signal.reason }));
      if (signal.aborted) {
        abort();
        return Object.assign(promise, { cancel });
      }
      signal.addEventListener("abort", abort);
      cleanups.add(() => signal.removeEventListener("abort", abort));
    }
    cleanups.add(onExit((code, signal2) => {
      reject(new ExitPromptError(`User force closed the prompt with ${code} ${signal2}`));
    }));
    const sigint = () => reject(new ExitPromptError(`User force closed the prompt with SIGINT`));
    rl.on("SIGINT", sigint);
    cleanups.add(() => rl.removeListener("SIGINT", sigint));
    const checkCursorPos = () => screen.checkCursorPos();
    rl.input.on("keypress", checkCursorPos);
    cleanups.add(() => rl.input.removeListener("keypress", checkCursorPos));
    return withHooks(rl, (cycle) => {
      const hooksCleanup = AsyncResource3.bind(() => effectScheduler.clearAll());
      rl.on("close", hooksCleanup);
      cleanups.add(() => rl.removeListener("close", hooksCleanup));
      cycle(() => {
        try {
          const nextView = view(config, (value) => {
            setImmediate(() => resolve5(value));
          });
          if (nextView === void 0) {
            const callerFilename = callSites[1]?.getFileName();
            throw new Error(`Prompt functions must return a string.
    at ${callerFilename}`);
          }
          const [content, bottomContent] = typeof nextView === "string" ? [nextView] : nextView;
          screen.render(content, bottomContent);
          effectScheduler.run();
        } catch (error2) {
          reject(error2);
        }
      });
      return Object.assign(promise.then((answer) => {
        effectScheduler.clearAll();
        return answer;
      }, (error2) => {
        effectScheduler.clearAll();
        throw error2;
      }).finally(() => {
        cleanups.forEach((cleanup) => cleanup());
        screen.done({ clearContent: Boolean(context.clearPromptOnDone) });
        output.end();
      }).then(() => promise), { cancel });
    });
  };
  return prompt;
}

// node_modules/@inquirer/core/dist/lib/Separator.js
import { styleText as styleText2 } from "util";
var Separator = class {
  separator = styleText2("dim", Array.from({ length: 15 }).join(dist_default.line));
  type = "separator";
  constructor(separator) {
    if (separator) {
      this.separator = separator;
    }
  }
  static isSeparator(choice) {
    return Boolean(choice && typeof choice === "object" && "type" in choice && choice.type === "separator");
  }
};

// node_modules/@inquirer/confirm/dist/index.js
function getBooleanValue(value, defaultValue) {
  let answer = defaultValue !== false;
  if (/^(y|yes)/i.test(value))
    answer = true;
  else if (/^(n|no)/i.test(value))
    answer = false;
  return answer;
}
function boolToString(value) {
  return value ? "Yes" : "No";
}
var dist_default4 = createPrompt((config, done) => {
  const { transformer = boolToString } = config;
  const [status, setStatus] = useState("idle");
  const [value, setValue] = useState("");
  const theme2 = makeTheme(config.theme);
  const prefix = usePrefix({ status, theme: theme2 });
  useKeypress((key, rl) => {
    if (status !== "idle")
      return;
    if (isEnterKey(key)) {
      const answer = getBooleanValue(value, config.default);
      setValue(transformer(answer));
      setStatus("done");
      done(answer);
    } else if (isTabKey(key)) {
      const answer = boolToString(!getBooleanValue(value, config.default));
      rl.clearLine(0);
      rl.write(answer);
      setValue(answer);
    } else {
      setValue(rl.line);
    }
  });
  let formattedValue = value;
  let defaultValue = "";
  if (status === "done") {
    formattedValue = theme2.style.answer(value);
  } else {
    defaultValue = ` ${theme2.style.defaultAnswer(config.default === false ? "y/N" : "Y/n")}`;
  }
  const message = theme2.style.message(config.message, status);
  return `${prefix} ${message}${defaultValue} ${formattedValue}`;
});

// node_modules/@inquirer/select/dist/index.js
import { styleText as styleText3 } from "util";
var selectTheme = {
  icon: { cursor: dist_default.pointer },
  style: {
    disabled: (text) => styleText3("dim", `- ${text}`),
    description: (text) => styleText3("cyan", text),
    keysHelpTip: (keys) => keys.map(([key, action]) => `${styleText3("bold", key)} ${styleText3("dim", action)}`).join(styleText3("dim", " \u2022 "))
  },
  indexMode: "hidden",
  keybindings: []
};
function isSelectable(item) {
  return !Separator.isSeparator(item) && !item.disabled;
}
function normalizeChoices(choices) {
  return choices.map((choice) => {
    if (Separator.isSeparator(choice))
      return choice;
    if (typeof choice !== "object" || choice === null || !("value" in choice)) {
      const name2 = String(choice);
      return {
        value: choice,
        name: name2,
        short: name2,
        disabled: false
      };
    }
    const name = choice.name ?? String(choice.value);
    const normalizedChoice = {
      value: choice.value,
      name,
      short: choice.short ?? name,
      disabled: choice.disabled ?? false
    };
    if (choice.description) {
      normalizedChoice.description = choice.description;
    }
    return normalizedChoice;
  });
}
var dist_default5 = createPrompt((config, done) => {
  const { loop = true, pageSize = 7 } = config;
  const theme2 = makeTheme(selectTheme, config.theme);
  const { keybindings } = theme2;
  const [status, setStatus] = useState("idle");
  const prefix = usePrefix({ status, theme: theme2 });
  const searchTimeoutRef = useRef();
  const searchEnabled = !keybindings.includes("vim");
  const items = useMemo(() => normalizeChoices(config.choices), [config.choices]);
  const bounds = useMemo(() => {
    const first = items.findIndex(isSelectable);
    const last = items.findLastIndex(isSelectable);
    if (first === -1) {
      throw new ValidationError("[select prompt] No selectable choices. All choices are disabled.");
    }
    return { first, last };
  }, [items]);
  const defaultItemIndex = useMemo(() => {
    if (!("default" in config))
      return -1;
    return items.findIndex((item) => isSelectable(item) && item.value === config.default);
  }, [config.default, items]);
  const [active, setActive] = useState(defaultItemIndex === -1 ? bounds.first : defaultItemIndex);
  const selectedChoice = items[active];
  useKeypress((key, rl) => {
    clearTimeout(searchTimeoutRef.current);
    if (isEnterKey(key)) {
      setStatus("done");
      done(selectedChoice.value);
    } else if (isUpKey(key, keybindings) || isDownKey(key, keybindings)) {
      rl.clearLine(0);
      if (loop || isUpKey(key, keybindings) && active !== bounds.first || isDownKey(key, keybindings) && active !== bounds.last) {
        const offset = isUpKey(key, keybindings) ? -1 : 1;
        let next = active;
        do {
          next = (next + offset + items.length) % items.length;
        } while (!isSelectable(items[next]));
        setActive(next);
      }
    } else if (isNumberKey(key) && !Number.isNaN(Number(rl.line))) {
      const selectedIndex = Number(rl.line) - 1;
      let selectableIndex = -1;
      const position = items.findIndex((item2) => {
        if (Separator.isSeparator(item2))
          return false;
        selectableIndex++;
        return selectableIndex === selectedIndex;
      });
      const item = items[position];
      if (item != null && isSelectable(item)) {
        setActive(position);
      }
      searchTimeoutRef.current = setTimeout(() => {
        rl.clearLine(0);
      }, 700);
    } else if (isBackspaceKey(key)) {
      rl.clearLine(0);
    } else if (searchEnabled) {
      const searchTerm = rl.line.toLowerCase();
      const matchIndex = items.findIndex((item) => {
        if (Separator.isSeparator(item) || !isSelectable(item))
          return false;
        return item.name.toLowerCase().startsWith(searchTerm);
      });
      if (matchIndex !== -1) {
        setActive(matchIndex);
      }
      searchTimeoutRef.current = setTimeout(() => {
        rl.clearLine(0);
      }, 700);
    }
  });
  useEffect(() => () => {
    clearTimeout(searchTimeoutRef.current);
  }, []);
  const message = theme2.style.message(config.message, status);
  const helpLine = theme2.style.keysHelpTip([
    ["\u2191\u2193", "navigate"],
    ["\u23CE", "select"]
  ]);
  let separatorCount = 0;
  const page = usePagination({
    items,
    active,
    renderItem({ item, isActive, index }) {
      if (Separator.isSeparator(item)) {
        separatorCount++;
        return ` ${item.separator}`;
      }
      const indexLabel = theme2.indexMode === "number" ? `${index + 1 - separatorCount}. ` : "";
      if (item.disabled) {
        const disabledLabel = typeof item.disabled === "string" ? item.disabled : "(disabled)";
        return theme2.style.disabled(`${indexLabel}${item.name} ${disabledLabel}`);
      }
      const color = isActive ? theme2.style.highlight : (x) => x;
      const cursor = isActive ? theme2.icon.cursor : ` `;
      return color(`${cursor} ${indexLabel}${item.name}`);
    },
    pageSize,
    loop
  });
  if (status === "done") {
    return [prefix, message, theme2.style.answer(selectedChoice.short)].filter(Boolean).join(" ");
  }
  const { description } = selectedChoice;
  const lines = [
    [prefix, message].filter(Boolean).join(" "),
    page,
    " ",
    description ? theme2.style.description(description) : "",
    helpLine
  ].filter(Boolean).join("\n").trimEnd();
  return `${lines}${cursorHide}`;
});

// src/detection.ts
init_backends();
var CLI_BACKENDS = [
  { name: "codex", installHint: "npm install -g @openai/codex", label: "OpenAI Codex CLI" },
  { name: "gemini", installHint: "npm install -g @google/gemini-cli", label: "Google Gemini CLI" }
];
var OLLAMA_DEFAULT_HOST = "http://localhost:11434";
var OLLAMA_INSTALL_HINT = "brew install ollama  # or: curl -fsSL https://ollama.com/install.sh | sh";
var API_BACKENDS = [
  { name: "openai", envVar: "OPENAI_API_KEY", installHint: "export OPENAI_API_KEY=sk-...", planned: false },
  { name: "anthropic", envVar: "ANTHROPIC_API_KEY", installHint: "export ANTHROPIC_API_KEY=sk-ant-...", planned: true },
  { name: "google", envVar: "GOOGLE_API_KEY", installHint: "export GOOGLE_API_KEY=...", planned: true }
];
var HOST_INTEGRATIONS = [
  { name: "claude", installHint: "npm install -g @anthropic-ai/claude-code", label: "Claude Code CLI" }
];
async function detectCliBackends(whichFn = isInPath) {
  return CLI_BACKENDS.map(({ name, installHint, label }) => {
    const found = whichFn(name);
    return {
      name,
      category: "cli",
      available: found,
      detail: found ? `${label} (found in PATH)` : "not found in PATH",
      installHint
    };
  });
}
async function detectLocalBackends(whichFn = isInPath, fetchFn = globalThis.fetch) {
  const binaryInstalled = whichFn("ollama");
  const host = process.env.OLLAMA_HOST ?? OLLAMA_DEFAULT_HOST;
  let serverResponding = false;
  let models = [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3e3);
    const resp = await fetchFn(`${host}/api/tags`, controller.signal);
    clearTimeout(timeout);
    if (resp.ok) {
      serverResponding = true;
      const data = await resp.json();
      models = (data.models ?? []).map((m) => m.name);
    }
  } catch {
  }
  let available = false;
  let detail;
  let installHint;
  if (binaryInstalled && serverResponding && models.length > 0) {
    available = true;
    detail = `${host} (${models.length} model${models.length !== 1 ? "s" : ""})`;
    installHint = "";
  } else if (binaryInstalled && serverResponding && models.length === 0) {
    detail = `${host} \u2014 no models pulled`;
    installHint = "ollama pull qwen3";
  } else if (binaryInstalled && !serverResponding) {
    detail = "installed but not running";
    installHint = "ollama serve";
  } else {
    detail = "not installed";
    installHint = OLLAMA_INSTALL_HINT;
  }
  return [{
    name: "ollama",
    category: "local",
    available,
    detail,
    installHint,
    models: models.length > 0 ? models : void 0
  }];
}
function detectApiBackends() {
  return API_BACKENDS.map(({ name, envVar, installHint, planned }) => {
    const keySet = !!process.env[envVar];
    return {
      name,
      category: "api",
      available: keySet && !planned,
      detail: keySet ? `${envVar} set` : `${envVar} not set`,
      installHint,
      planned
    };
  });
}
async function detectHostIntegrations(whichFn = isInPath) {
  return HOST_INTEGRATIONS.map(({ name, installHint, label }) => {
    const found = whichFn(name);
    return {
      name,
      category: "host",
      available: found,
      detail: found ? `${label} (found in PATH)` : "not found in PATH",
      installHint
    };
  });
}
async function detectAll(whichFn = isInPath, fetchFn = globalThis.fetch) {
  const [cli, local, host] = await Promise.all([
    detectCliBackends(whichFn),
    detectLocalBackends(whichFn, fetchFn),
    detectHostIntegrations(whichFn)
  ]);
  const api = detectApiBackends();
  return { cli, local, api, host };
}

// src/config.ts
import { readFileSync as readFileSync4, writeFileSync as writeFileSync2, existsSync as existsSync4, mkdirSync as mkdirSync2 } from "fs";
import { join as join3, dirname as dirname3 } from "path";

// node_modules/smol-toml/dist/error.js
function getLineColFromPtr(string, ptr) {
  let lines = string.slice(0, ptr).split(/\r\n|\n|\r/g);
  return [lines.length, lines.pop().length + 1];
}
function makeCodeBlock(string, line, column) {
  let lines = string.split(/\r\n|\n|\r/g);
  let codeblock = "";
  let numberLen = (Math.log10(line + 1) | 0) + 1;
  for (let i = line - 1; i <= line + 1; i++) {
    let l = lines[i - 1];
    if (!l)
      continue;
    codeblock += i.toString().padEnd(numberLen, " ");
    codeblock += ":  ";
    codeblock += l;
    codeblock += "\n";
    if (i === line) {
      codeblock += " ".repeat(numberLen + column + 2);
      codeblock += "^\n";
    }
  }
  return codeblock;
}
var TomlError = class extends Error {
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
};

// node_modules/smol-toml/dist/util.js
function isEscaped(str, ptr) {
  let i = 0;
  while (str[ptr - ++i] === "\\")
    ;
  return --i && i % 2;
}
function indexOfNewline(str, start = 0, end = str.length) {
  let idx = str.indexOf("\n", start);
  if (str[idx - 1] === "\r")
    idx--;
  return idx <= end ? idx : -1;
}
function skipComment(str, ptr) {
  for (let i = ptr; i < str.length; i++) {
    let c = str[i];
    if (c === "\n")
      return i;
    if (c === "\r" && str[i + 1] === "\n")
      return i + 1;
    if (c < " " && c !== "	" || c === "\x7F") {
      throw new TomlError("control characters are not allowed in comments", {
        toml: str,
        ptr
      });
    }
  }
  return str.length;
}
function skipVoid(str, ptr, banNewLines, banComments) {
  let c;
  while ((c = str[ptr]) === " " || c === "	" || !banNewLines && (c === "\n" || c === "\r" && str[ptr + 1] === "\n"))
    ptr++;
  return banComments || c !== "#" ? ptr : skipVoid(str, skipComment(str, ptr), banNewLines);
}
function skipUntil(str, ptr, sep, end, banNewLines = false) {
  if (!end) {
    ptr = indexOfNewline(str, ptr);
    return ptr < 0 ? str.length : ptr;
  }
  for (let i = ptr; i < str.length; i++) {
    let c = str[i];
    if (c === "#") {
      i = indexOfNewline(str, i);
    } else if (c === sep) {
      return i + 1;
    } else if (c === end || banNewLines && (c === "\n" || c === "\r" && str[i + 1] === "\n")) {
      return i;
    }
  }
  throw new TomlError("cannot find end of structure", {
    toml: str,
    ptr
  });
}
function getStringEnd(str, seek) {
  let first = str[seek];
  let target = first === str[seek + 1] && str[seek + 1] === str[seek + 2] ? str.slice(seek, seek + 3) : first;
  seek += target.length - 1;
  do
    seek = str.indexOf(target, ++seek);
  while (seek > -1 && first !== "'" && isEscaped(str, seek));
  if (seek > -1) {
    seek += target.length;
    if (target.length > 1) {
      if (str[seek] === first)
        seek++;
      if (str[seek] === first)
        seek++;
    }
  }
  return seek;
}

// node_modules/smol-toml/dist/date.js
var DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})?[T ]?(?:(\d{2}):\d{2}(?::\d{2}(?:\.\d+)?)?)?(Z|[-+]\d{2}:\d{2})?$/i;
var TomlDate = class _TomlDate extends Date {
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
    let offsetDate = new Date(this.getTime() - offset * 6e4);
    return offsetDate.toISOString().slice(0, -1) + this.#offset;
  }
  static wrapAsOffsetDateTime(jsDate, offset = "Z") {
    let date = new _TomlDate(jsDate);
    date.#offset = offset;
    return date;
  }
  static wrapAsLocalDateTime(jsDate) {
    let date = new _TomlDate(jsDate);
    date.#offset = null;
    return date;
  }
  static wrapAsLocalDate(jsDate) {
    let date = new _TomlDate(jsDate);
    date.#hasTime = false;
    date.#offset = null;
    return date;
  }
  static wrapAsLocalTime(jsDate) {
    let date = new _TomlDate(jsDate);
    date.#hasDate = false;
    date.#offset = null;
    return date;
  }
};

// node_modules/smol-toml/dist/primitive.js
var INT_REGEX = /^((0x[0-9a-fA-F](_?[0-9a-fA-F])*)|(([+-]|0[ob])?\d(_?\d)*))$/;
var FLOAT_REGEX = /^[+-]?\d(_?\d)*(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?$/;
var LEADING_ZERO = /^[+-]?0[0-9_]/;
var ESCAPE_REGEX = /^[0-9a-f]{2,8}$/i;
var ESC_MAP = {
  b: "\b",
  t: "	",
  n: "\n",
  f: "\f",
  r: "\r",
  e: "\x1B",
  '"': '"',
  "\\": "\\"
};
function parseString(str, ptr = 0, endPtr = str.length) {
  let isLiteral = str[ptr] === "'";
  let isMultiline = str[ptr++] === str[ptr] && str[ptr] === str[ptr + 1];
  if (isMultiline) {
    endPtr -= 2;
    if (str[ptr += 2] === "\r")
      ptr++;
    if (str[ptr] === "\n")
      ptr++;
  }
  let tmp = 0;
  let isEscape;
  let parsed = "";
  let sliceStart = ptr;
  while (ptr < endPtr - 1) {
    let c = str[ptr++];
    if (c === "\n" || c === "\r" && str[ptr] === "\n") {
      if (!isMultiline) {
        throw new TomlError("newlines are not allowed in strings", {
          toml: str,
          ptr: ptr - 1
        });
      }
    } else if (c < " " && c !== "	" || c === "\x7F") {
      throw new TomlError("control characters are not allowed in strings", {
        toml: str,
        ptr: ptr - 1
      });
    }
    if (isEscape) {
      isEscape = false;
      if (c === "x" || c === "u" || c === "U") {
        let code = str.slice(ptr, ptr += c === "x" ? 2 : c === "u" ? 4 : 8);
        if (!ESCAPE_REGEX.test(code)) {
          throw new TomlError("invalid unicode escape", {
            toml: str,
            ptr: tmp
          });
        }
        try {
          parsed += String.fromCodePoint(parseInt(code, 16));
        } catch {
          throw new TomlError("invalid unicode escape", {
            toml: str,
            ptr: tmp
          });
        }
      } else if (isMultiline && (c === "\n" || c === " " || c === "	" || c === "\r")) {
        ptr = skipVoid(str, ptr - 1, true);
        if (str[ptr] !== "\n" && str[ptr] !== "\r") {
          throw new TomlError("invalid escape: only line-ending whitespace may be escaped", {
            toml: str,
            ptr: tmp
          });
        }
        ptr = skipVoid(str, ptr);
      } else if (c in ESC_MAP) {
        parsed += ESC_MAP[c];
      } else {
        throw new TomlError("unrecognized escape sequence", {
          toml: str,
          ptr: tmp
        });
      }
      sliceStart = ptr;
    } else if (!isLiteral && c === "\\") {
      tmp = ptr - 1;
      isEscape = true;
      parsed += str.slice(sliceStart, tmp);
    }
  }
  return parsed + str.slice(sliceStart, endPtr - 1);
}
function parseValue(value, toml, ptr, integersAsBigInt) {
  if (value === "true")
    return true;
  if (value === "false")
    return false;
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
      throw new TomlError("leading zeroes are not allowed", {
        toml,
        ptr
      });
    }
    value = value.replace(/_/g, "");
    let numeric = +value;
    if (isNaN(numeric)) {
      throw new TomlError("invalid number", {
        toml,
        ptr
      });
    }
    if (isInt) {
      if ((isInt = !Number.isSafeInteger(numeric)) && !integersAsBigInt) {
        throw new TomlError("integer value cannot be represented losslessly", {
          toml,
          ptr
        });
      }
      if (isInt || integersAsBigInt === true)
        numeric = BigInt(value);
    }
    return numeric;
  }
  const date = new TomlDate(value);
  if (!date.isValid()) {
    throw new TomlError("invalid value", {
      toml,
      ptr
    });
  }
  return date;
}

// node_modules/smol-toml/dist/extract.js
function sliceAndTrimEndOf(str, startPtr, endPtr) {
  let value = str.slice(startPtr, endPtr);
  let commentIdx = value.indexOf("#");
  if (commentIdx > -1) {
    skipComment(str, commentIdx);
    value = value.slice(0, commentIdx);
  }
  return [value.trimEnd(), commentIdx];
}
function extractValue(str, ptr, end, depth, integersAsBigInt) {
  if (depth === 0) {
    throw new TomlError("document contains excessively nested structures. aborting.", {
      toml: str,
      ptr
    });
  }
  let c = str[ptr];
  if (c === "[" || c === "{") {
    let [value, endPtr2] = c === "[" ? parseArray(str, ptr, depth, integersAsBigInt) : parseInlineTable(str, ptr, depth, integersAsBigInt);
    if (end) {
      endPtr2 = skipVoid(str, endPtr2);
      if (str[endPtr2] === ",")
        endPtr2++;
      else if (str[endPtr2] !== end) {
        throw new TomlError("expected comma or end of structure", {
          toml: str,
          ptr: endPtr2
        });
      }
    }
    return [value, endPtr2];
  }
  let endPtr;
  if (c === '"' || c === "'") {
    endPtr = getStringEnd(str, ptr);
    let parsed = parseString(str, ptr, endPtr);
    if (end) {
      endPtr = skipVoid(str, endPtr);
      if (str[endPtr] && str[endPtr] !== "," && str[endPtr] !== end && str[endPtr] !== "\n" && str[endPtr] !== "\r") {
        throw new TomlError("unexpected character encountered", {
          toml: str,
          ptr: endPtr
        });
      }
      endPtr += +(str[endPtr] === ",");
    }
    return [parsed, endPtr];
  }
  endPtr = skipUntil(str, ptr, ",", end);
  let slice = sliceAndTrimEndOf(str, ptr, endPtr - +(str[endPtr - 1] === ","));
  if (!slice[0]) {
    throw new TomlError("incomplete key-value declaration: no value specified", {
      toml: str,
      ptr
    });
  }
  if (end && slice[1] > -1) {
    endPtr = skipVoid(str, ptr + slice[1]);
    endPtr += +(str[endPtr] === ",");
  }
  return [
    parseValue(slice[0], str, ptr, integersAsBigInt),
    endPtr
  ];
}

// node_modules/smol-toml/dist/struct.js
var KEY_PART_RE = /^[a-zA-Z0-9-_]+[ \t]*$/;
function parseKey(str, ptr, end = "=") {
  let dot = ptr - 1;
  let parsed = [];
  let endPtr = str.indexOf(end, ptr);
  if (endPtr < 0) {
    throw new TomlError("incomplete key-value: cannot find end of key", {
      toml: str,
      ptr
    });
  }
  do {
    let c = str[ptr = ++dot];
    if (c !== " " && c !== "	") {
      if (c === '"' || c === "'") {
        if (c === str[ptr + 1] && c === str[ptr + 2]) {
          throw new TomlError("multiline strings are not allowed in keys", {
            toml: str,
            ptr
          });
        }
        let eos = getStringEnd(str, ptr);
        if (eos < 0) {
          throw new TomlError("unfinished string encountered", {
            toml: str,
            ptr
          });
        }
        dot = str.indexOf(".", eos);
        let strEnd = str.slice(eos, dot < 0 || dot > endPtr ? endPtr : dot);
        let newLine = indexOfNewline(strEnd);
        if (newLine > -1) {
          throw new TomlError("newlines are not allowed in keys", {
            toml: str,
            ptr: ptr + dot + newLine
          });
        }
        if (strEnd.trimStart()) {
          throw new TomlError("found extra tokens after the string part", {
            toml: str,
            ptr: eos
          });
        }
        if (endPtr < eos) {
          endPtr = str.indexOf(end, eos);
          if (endPtr < 0) {
            throw new TomlError("incomplete key-value: cannot find end of key", {
              toml: str,
              ptr
            });
          }
        }
        parsed.push(parseString(str, ptr, eos));
      } else {
        dot = str.indexOf(".", ptr);
        let part = str.slice(ptr, dot < 0 || dot > endPtr ? endPtr : dot);
        if (!KEY_PART_RE.test(part)) {
          throw new TomlError("only letter, numbers, dashes and underscores are allowed in keys", {
            toml: str,
            ptr
          });
        }
        parsed.push(part.trimEnd());
      }
    }
  } while (dot + 1 && dot < endPtr);
  return [parsed, skipVoid(str, endPtr + 1, true, true)];
}
function parseInlineTable(str, ptr, depth, integersAsBigInt) {
  let res = {};
  let seen = /* @__PURE__ */ new Set();
  let c;
  ptr++;
  while ((c = str[ptr++]) !== "}" && c) {
    if (c === ",") {
      throw new TomlError("expected value, found comma", {
        toml: str,
        ptr: ptr - 1
      });
    } else if (c === "#")
      ptr = skipComment(str, ptr);
    else if (c !== " " && c !== "	" && c !== "\n" && c !== "\r") {
      let k;
      let t = res;
      let hasOwn = false;
      let [key, keyEndPtr] = parseKey(str, ptr - 1);
      for (let i = 0; i < key.length; i++) {
        if (i)
          t = hasOwn ? t[k] : t[k] = {};
        k = key[i];
        if ((hasOwn = Object.hasOwn(t, k)) && (typeof t[k] !== "object" || seen.has(t[k]))) {
          throw new TomlError("trying to redefine an already defined value", {
            toml: str,
            ptr
          });
        }
        if (!hasOwn && k === "__proto__") {
          Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
        }
      }
      if (hasOwn) {
        throw new TomlError("trying to redefine an already defined value", {
          toml: str,
          ptr
        });
      }
      let [value, valueEndPtr] = extractValue(str, keyEndPtr, "}", depth - 1, integersAsBigInt);
      seen.add(value);
      t[k] = value;
      ptr = valueEndPtr;
    }
  }
  if (!c) {
    throw new TomlError("unfinished table encountered", {
      toml: str,
      ptr
    });
  }
  return [res, ptr];
}
function parseArray(str, ptr, depth, integersAsBigInt) {
  let res = [];
  let c;
  ptr++;
  while ((c = str[ptr++]) !== "]" && c) {
    if (c === ",") {
      throw new TomlError("expected value, found comma", {
        toml: str,
        ptr: ptr - 1
      });
    } else if (c === "#")
      ptr = skipComment(str, ptr);
    else if (c !== " " && c !== "	" && c !== "\n" && c !== "\r") {
      let e = extractValue(str, ptr - 1, "]", depth - 1, integersAsBigInt);
      res.push(e[0]);
      ptr = e[1];
    }
  }
  if (!c) {
    throw new TomlError("unfinished array encountered", {
      toml: str,
      ptr
    });
  }
  return [res, ptr];
}

// node_modules/smol-toml/dist/parse.js
function peekTable(key, table, meta, type) {
  let t = table;
  let m = meta;
  let k;
  let hasOwn = false;
  let state;
  for (let i = 0; i < key.length; i++) {
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
function parse(toml, { maxDepth = 1e3, integersAsBigInt } = {}) {
  let res = {};
  let meta = {};
  let tbl = res;
  let m = meta;
  for (let ptr = skipVoid(toml, 0); ptr < toml.length; ) {
    if (toml[ptr] === "[") {
      let isTableArray = toml[++ptr] === "[";
      let k = parseKey(toml, ptr += +isTableArray, "]");
      if (isTableArray) {
        if (toml[k[1] - 1] !== "]") {
          throw new TomlError("expected end of table declaration", {
            toml,
            ptr: k[1] - 1
          });
        }
        k[1]++;
      }
      let p = peekTable(
        k[0],
        res,
        meta,
        isTableArray ? 2 : 1
        /* Type.EXPLICIT */
      );
      if (!p) {
        throw new TomlError("trying to redefine an already defined table or value", {
          toml,
          ptr
        });
      }
      m = p[2];
      tbl = p[1];
      ptr = k[1];
    } else {
      let k = parseKey(toml, ptr);
      let p = peekTable(
        k[0],
        tbl,
        m,
        0
        /* Type.DOTTED */
      );
      if (!p) {
        throw new TomlError("trying to redefine an already defined table or value", {
          toml,
          ptr
        });
      }
      let v = extractValue(toml, k[1], void 0, maxDepth, integersAsBigInt);
      p[1][p[0]] = v[0];
      ptr = v[1];
    }
    ptr = skipVoid(toml, ptr, true);
    if (toml[ptr] && toml[ptr] !== "\n" && toml[ptr] !== "\r") {
      throw new TomlError("each key-value declaration must be followed by an end-of-line", {
        toml,
        ptr
      });
    }
    ptr = skipVoid(toml, ptr);
  }
  return res;
}

// node_modules/smol-toml/dist/stringify.js
var BARE_KEY = /^[a-z0-9-_]+$/i;
function extendedTypeOf(obj) {
  let type = typeof obj;
  if (type === "object") {
    if (Array.isArray(obj))
      return "array";
    if (obj instanceof Date)
      return "date";
  }
  return type;
}
function isArrayOfTables(obj) {
  for (let i = 0; i < obj.length; i++) {
    if (extendedTypeOf(obj[i]) !== "object")
      return false;
  }
  return obj.length != 0;
}
function formatString(s) {
  return JSON.stringify(s).replace(/\x7f/g, "\\u007f");
}
function stringifyValue(val, type, depth, numberAsFloat) {
  if (depth === 0) {
    throw new Error("Could not stringify the object: maximum object depth exceeded");
  }
  if (type === "number") {
    if (isNaN(val))
      return "nan";
    if (val === Infinity)
      return "inf";
    if (val === -Infinity)
      return "-inf";
    if (numberAsFloat && Number.isInteger(val))
      return val.toFixed(1);
    return val.toString();
  }
  if (type === "bigint" || type === "boolean") {
    return val.toString();
  }
  if (type === "string") {
    return formatString(val);
  }
  if (type === "date") {
    if (isNaN(val.getTime())) {
      throw new TypeError("cannot serialize invalid date");
    }
    return val.toISOString();
  }
  if (type === "object") {
    return stringifyInlineTable(val, depth, numberAsFloat);
  }
  if (type === "array") {
    return stringifyArray(val, depth, numberAsFloat);
  }
}
function stringifyInlineTable(obj, depth, numberAsFloat) {
  let keys = Object.keys(obj);
  if (keys.length === 0)
    return "{}";
  let res = "{ ";
  for (let i = 0; i < keys.length; i++) {
    let k = keys[i];
    if (i)
      res += ", ";
    res += BARE_KEY.test(k) ? k : formatString(k);
    res += " = ";
    res += stringifyValue(obj[k], extendedTypeOf(obj[k]), depth - 1, numberAsFloat);
  }
  return res + " }";
}
function stringifyArray(array, depth, numberAsFloat) {
  if (array.length === 0)
    return "[]";
  let res = "[ ";
  for (let i = 0; i < array.length; i++) {
    if (i)
      res += ", ";
    if (array[i] === null || array[i] === void 0) {
      throw new TypeError("arrays cannot contain null or undefined values");
    }
    res += stringifyValue(array[i], extendedTypeOf(array[i]), depth - 1, numberAsFloat);
  }
  return res + " ]";
}
function stringifyArrayTable(array, key, depth, numberAsFloat) {
  if (depth === 0) {
    throw new Error("Could not stringify the object: maximum object depth exceeded");
  }
  let res = "";
  for (let i = 0; i < array.length; i++) {
    res += `${res && "\n"}[[${key}]]
`;
    res += stringifyTable(0, array[i], key, depth, numberAsFloat);
  }
  return res;
}
function stringifyTable(tableKey, obj, prefix, depth, numberAsFloat) {
  if (depth === 0) {
    throw new Error("Could not stringify the object: maximum object depth exceeded");
  }
  let preamble = "";
  let tables = "";
  let keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i++) {
    let k = keys[i];
    if (obj[k] !== null && obj[k] !== void 0) {
      let type = extendedTypeOf(obj[k]);
      if (type === "symbol" || type === "function") {
        throw new TypeError(`cannot serialize values of type '${type}'`);
      }
      let key = BARE_KEY.test(k) ? k : formatString(k);
      if (type === "array" && isArrayOfTables(obj[k])) {
        tables += (tables && "\n") + stringifyArrayTable(obj[k], prefix ? `${prefix}.${key}` : key, depth - 1, numberAsFloat);
      } else if (type === "object") {
        let tblKey = prefix ? `${prefix}.${key}` : key;
        tables += (tables && "\n") + stringifyTable(tblKey, obj[k], tblKey, depth - 1, numberAsFloat);
      } else {
        preamble += key;
        preamble += " = ";
        preamble += stringifyValue(obj[k], type, depth, numberAsFloat);
        preamble += "\n";
      }
    }
  }
  if (tableKey && (preamble || !tables))
    preamble = preamble ? `[${tableKey}]
${preamble}` : `[${tableKey}]`;
  return preamble && tables ? `${preamble}
${tables}` : preamble || tables;
}
function stringify(obj, { maxDepth = 1e3, numbersAsFloat = false } = {}) {
  if (extendedTypeOf(obj) !== "object") {
    throw new TypeError("stringify can only be called with an object");
  }
  let str = stringifyTable(0, obj, "", maxDepth, numbersAsFloat);
  if (str[str.length - 1] !== "\n")
    return str + "\n";
  return str;
}

// src/config.ts
var DEFAULT_CONFIG = {
  defaults: {
    backend: "codex",
    sandbox: "read-only",
    timeout: 600,
    include_diff: false
  }
};
function configPaths(repoRoot, xdgConfigHome, homeDir) {
  const configBase = xdgConfigHome ?? process.env.XDG_CONFIG_HOME ?? join3(homeDir ?? __require("os").homedir(), ".config");
  return {
    user: join3(configBase, "phone-a-friend", "config.toml"),
    repo: repoRoot ? join3(repoRoot, ".phone-a-friend.toml") : null
  };
}
function deepMerge2(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];
    if (srcVal !== null && typeof srcVal === "object" && !Array.isArray(srcVal) && tgtVal !== null && typeof tgtVal === "object" && !Array.isArray(tgtVal)) {
      result[key] = deepMerge2(tgtVal, srcVal);
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}
function loadConfigFromFile(filePath) {
  if (!existsSync4(filePath)) {
    return { ...DEFAULT_CONFIG, defaults: { ...DEFAULT_CONFIG.defaults } };
  }
  try {
    const content = readFileSync4(filePath, "utf-8");
    const parsed = parse(content);
    const merged = deepMerge2(
      { defaults: { ...DEFAULT_CONFIG.defaults } },
      parsed
    );
    return merged;
  } catch {
    return { ...DEFAULT_CONFIG, defaults: { ...DEFAULT_CONFIG.defaults } };
  }
}
function loadConfig(repoRoot, xdgConfigHome, homeDir) {
  const paths = configPaths(repoRoot, xdgConfigHome, homeDir);
  let config = { ...DEFAULT_CONFIG, defaults: { ...DEFAULT_CONFIG.defaults } };
  config = loadConfigFromFile(paths.user);
  if (paths.repo && existsSync4(paths.repo)) {
    const repoConfig = parse(readFileSync4(paths.repo, "utf-8"));
    config = deepMerge2(config, repoConfig);
  }
  return config;
}
function saveConfig(cfg, filePath) {
  mkdirSync2(dirname3(filePath), { recursive: true });
  const content = stringify(cfg);
  writeFileSync2(filePath, content, "utf-8");
}
function configInit(filePath, force = false) {
  if (!force && existsSync4(filePath)) {
    throw new Error(`Config already exists at ${filePath}. Use --force to overwrite.`);
  }
  saveConfig(DEFAULT_CONFIG, filePath);
}
function configGet(key, cfg) {
  const parts = key.split(".");
  let current = cfg;
  for (const part of parts) {
    if (current === null || current === void 0 || typeof current !== "object") {
      return void 0;
    }
    current = current[part];
  }
  return current;
}
function configSet(key, rawValue, filePath) {
  let cfg;
  if (existsSync4(filePath)) {
    const content = readFileSync4(filePath, "utf-8");
    cfg = parse(content);
  } else {
    cfg = { defaults: { ...DEFAULT_CONFIG.defaults } };
  }
  let value;
  if (rawValue.toLowerCase() === "true") {
    value = true;
  } else if (rawValue.toLowerCase() === "false") {
    value = false;
  } else if (/^\d+$/.test(rawValue)) {
    value = Number(rawValue);
  } else {
    value = rawValue;
  }
  const parts = key.split(".");
  let current = cfg;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== "object" || current[part] === null) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
  saveConfig(cfg, filePath);
}
function resolveConfig(cliOpts, env2 = process.env, repoRoot, xdgConfigHome) {
  const cfg = loadConfig(repoRoot, xdgConfigHome);
  const backend = cliOpts.to ?? env2.PHONE_A_FRIEND_BACKEND ?? cfg.defaults.backend;
  const sandbox = cliOpts.sandbox ?? env2.PHONE_A_FRIEND_SANDBOX ?? cfg.defaults.sandbox;
  const timeoutRaw = cliOpts.timeout ?? env2.PHONE_A_FRIEND_TIMEOUT ?? String(cfg.defaults.timeout);
  const timeout = /^\d+$/.test(timeoutRaw) ? Number(timeoutRaw) : cfg.defaults.timeout;
  const includeDiffRaw = cliOpts.includeDiff ?? env2.PHONE_A_FRIEND_INCLUDE_DIFF;
  const includeDiff = includeDiffRaw !== void 0 ? includeDiffRaw === "true" || includeDiffRaw === "1" : cfg.defaults.include_diff;
  const model = cliOpts.model ?? cfg.backends?.[backend]?.model ?? void 0;
  return { backend, sandbox, timeout, includeDiff, model };
}

// src/display.ts
function mark(available, planned) {
  if (planned) return theme.planned;
  return available ? theme.checkmark : theme.crossmark;
}
function formatBackendLine(b) {
  const m = mark(b.available, b.planned);
  const line = `    ${m} ${b.name.padEnd(12)} ${b.detail}`;
  if (!b.available && !b.planned && b.installHint) {
    return `${line}
${" ".repeat(19)}${theme.hint(b.installHint)}`;
  }
  return line;
}
function formatBackendModels(b) {
  if (b.models && b.models.length > 0) {
    return `${" ".repeat(21)}Models: ${b.models.join(", ")}`;
  }
  return null;
}

// src/setup.ts
function printBackendLine(b) {
  console.log(`    ${formatBackendLine(b).trimStart()}`);
  const modelsLine = formatBackendModels(b);
  if (modelsLine) console.log(modelsLine);
}
function printReport(report) {
  console.log("  Relay Backends:");
  if (report.cli.length > 0) {
    console.log("    CLI:");
    for (const b of report.cli) printBackendLine(b);
  }
  if (report.local.length > 0) {
    console.log("    Local:");
    for (const b of report.local) printBackendLine(b);
  }
  if (report.api.length > 0) {
    console.log("    API:");
    for (const b of report.api) printBackendLine(b);
  }
  console.log("");
  console.log("  Host Integrations:");
  for (const b of report.host) printBackendLine(b);
}
function getSelectableBackends(report) {
  const allRelay = [...report.cli, ...report.local, ...report.api];
  return allRelay.filter((b) => b.available && !b.planned);
}
async function setup(opts) {
  const paths = configPaths(opts?.repoRoot);
  console.log("");
  console.log(banner("Setup"));
  console.log("");
  const scanSpinner = ora({
    text: "Scanning your environment...",
    spinner: "dots",
    color: "cyan",
    stream: process.stderr
  }).start();
  const report = await detectAll();
  scanSpinner.succeed("Environment scanned");
  console.log("");
  printReport(report);
  console.log("");
  const selectable = getSelectableBackends(report);
  let selectedBackend;
  console.log(`  ${theme.hint("Step 1/3")} ${theme.heading("Choose default backend")}`);
  if (selectable.length === 0) {
    console.log(theme.warning("  No relay backends available."));
    console.log("  Install at least one backend to get started:");
    const allRelay = [...report.cli, ...report.local, ...report.api];
    for (const b of allRelay) {
      if (!b.planned && b.installHint) {
        console.log(`    ${b.name}: ${theme.hint(b.installHint)}`);
      }
    }
    console.log("");
    selectedBackend = DEFAULT_CONFIG.defaults.backend;
  } else if (selectable.length === 1) {
    selectedBackend = selectable[0].name;
    console.log(`  Default backend: ${theme.bold(selectedBackend)} (only available backend)`);
  } else {
    selectedBackend = await dist_default5({
      message: "Default backend:",
      choices: selectable.map((b) => ({
        name: `${b.name} (${b.detail})`,
        value: b.name
      }))
    });
  }
  const claudeAvailable = report.host.some((h) => h.name === "claude" && h.available);
  if (claudeAvailable) {
    console.log(`  ${theme.hint("Step 2/3")} ${theme.heading("Claude integration")}`);
    const installPlugin = await dist_default4({
      message: "Install as Claude Code plugin?",
      default: true
    });
    if (installPlugin) {
      try {
        const repoRoot = opts?.repoRoot ?? process.cwd();
        const lines = installHosts({
          repoRoot,
          target: "claude",
          mode: "symlink",
          force: true,
          syncClaudeCli: true
        });
        for (const line of lines) console.log(`  ${line}`);
      } catch (err) {
        console.log(theme.warning(`  Plugin install failed: ${err.message}`));
      }
    }
  }
  const existing = loadConfig(opts?.repoRoot);
  const cfg = {
    ...existing,
    defaults: {
      ...existing.defaults,
      backend: selectedBackend
    }
  };
  saveConfig(cfg, paths.user);
  console.log("");
  console.log(`  ${theme.checkmark} Config saved to ${paths.user}`);
  if (selectable.length > 0) {
    console.log(`  ${theme.hint("Step 3/3")} ${theme.heading("Verify")}`);
    const runTest = await dist_default4({
      message: "Run a quick test?",
      default: true
    });
    if (runTest) {
      const testSpinner = ora({
        text: `Testing ${selectedBackend}...`,
        spinner: "dots",
        color: "cyan",
        stream: process.stderr
      }).start();
      try {
        const { relay: relay2 } = await Promise.resolve().then(() => (init_relay(), relay_exports));
        relay2({
          prompt: "Say hello in one sentence.",
          repoPath: process.cwd(),
          backend: selectedBackend,
          timeoutSeconds: 30
        });
        testSpinner.succeed(`${selectedBackend} responded`);
      } catch (err) {
        testSpinner.fail(`${selectedBackend} test failed: ${err.message}`);
      }
    }
  }
  console.log("");
  console.log(`  ${theme.checkmark} ${theme.success("Setup complete!")}`);
  console.log("");
  console.log(`  ${theme.label("Backend:")}  ${selectedBackend}`);
  console.log(`  ${theme.label("Config:")}   ${paths.user}`);
  console.log("");
  console.log(`  Tip: ${theme.hint("alias paf='phone-a-friend'")}`);
  console.log("");
}

// src/doctor.ts
function formatHumanReadable(report, config, paths) {
  const lines = [];
  lines.push("");
  lines.push(banner("Health Check"));
  lines.push("");
  lines.push(`  ${theme.label("System:")}`);
  lines.push(`    ${theme.checkmark} Node.js ${process.version}`);
  lines.push(`    ${theme.checkmark} Config ${paths.user}`);
  lines.push("");
  lines.push(`  ${theme.label("Relay Backends:")}`);
  if (report.cli.length > 0) {
    lines.push("    CLI:");
    for (const b of report.cli) {
      lines.push(`  ${formatBackendLine(b)}`);
    }
  }
  if (report.local.length > 0) {
    lines.push("    Local:");
    for (const b of report.local) {
      lines.push(`  ${formatBackendLine(b)}`);
      const modelsLine = formatBackendModels(b);
      if (modelsLine) lines.push(modelsLine);
    }
  }
  if (report.api.length > 0) {
    lines.push("    API:");
    for (const b of report.api) {
      lines.push(`  ${formatBackendLine(b)}`);
    }
  }
  lines.push("");
  lines.push(`  ${theme.label("Host Integrations:")}`);
  for (const b of report.host) {
    lines.push(`  ${formatBackendLine(b)}`);
  }
  lines.push("");
  const defaultBackend = config.defaults?.backend ?? DEFAULT_CONFIG.defaults.backend;
  lines.push(`  ${theme.label("Default:")} ${defaultBackend}`);
  lines.push("");
  const allRelay = [...report.cli, ...report.local, ...report.api];
  const available = allRelay.filter((b) => b.available).length;
  const total = allRelay.length;
  const summaryColor = available === total ? theme.success : available > 0 ? theme.warning : theme.error;
  lines.push(`  ${summaryColor(`${available} of ${total} relay backends ready`)}`);
  lines.push("");
  return lines.join("\n");
}
function formatJson(report, config, exitCode) {
  const allRelay = [...report.cli, ...report.local, ...report.api];
  const available = allRelay.filter((b) => b.available).length;
  const total = allRelay.length;
  return JSON.stringify({
    system: {
      nodeVersion: process.version,
      version: getVersion()
    },
    backends: {
      cli: report.cli,
      local: report.local,
      api: report.api
    },
    host: report.host,
    default: config.defaults?.backend ?? DEFAULT_CONFIG.defaults.backend,
    summary: { available, total },
    exitCode
  }, null, 2);
}
function computeExitCode(report) {
  const allRelay = [...report.cli, ...report.local, ...report.api].filter((b) => !b.planned);
  const available = allRelay.filter((b) => b.available).length;
  if (available === 0) return 2;
  const total = allRelay.length;
  if (available < total) return 1;
  return 0;
}
async function doctor(opts) {
  const report = await detectAll();
  const paths = configPaths(opts?.repoRoot);
  const config = loadConfig(opts?.repoRoot);
  const exitCode = computeExitCode(report);
  if (opts?.json) {
    return {
      exitCode,
      output: formatJson(report, config, exitCode)
    };
  }
  return {
    exitCode,
    output: formatHumanReadable(report, config, paths)
  };
}

// src/cli.ts
function repoRootDefault() {
  const thisDir = dirname4(fileURLToPath2(import.meta.url));
  return resolve4(thisDir, "..");
}
var KNOWN_SUBCOMMANDS = ["relay", "install", "update", "uninstall", "setup", "doctor", "config", "plugin"];
var TOP_LEVEL_FLAGS = /* @__PURE__ */ new Set(["-V", "--version", "-h", "--help"]);
function normalizeArgv(argv) {
  if (argv.length === 0) return argv;
  const first = argv[0];
  if (KNOWN_SUBCOMMANDS.includes(first)) {
    return argv;
  }
  if (TOP_LEVEL_FLAGS.has(first)) {
    return argv;
  }
  if (first.startsWith("-")) {
    return ["relay", ...argv];
  }
  return argv;
}
function printBackendAvailability() {
  console.log("\nBackend availability:");
  for (const info2 of verifyBackends()) {
    const mark2 = info2.available ? "\u2713" : "\u2717";
    const status = info2.available ? "available" : "not found";
    console.log(`  ${mark2} ${info2.name}: ${status}`);
    if (!info2.available && info2.hint) {
      console.log(`    Install: ${info2.hint}`);
    }
  }
}
function installAction(opts) {
  const target = opts.all ? "all" : "claude";
  const lines = installHosts({
    repoRoot: opts.repoRoot ?? repoRootDefault(),
    target,
    mode: opts.mode ?? "symlink",
    force: opts.force ?? false,
    syncClaudeCli: opts.claudeCliSync !== false
  });
  for (const line of lines) console.log(line);
  printBackendAvailability();
}
function updateAction(opts) {
  const lines = installHosts({
    repoRoot: opts.repoRoot ?? repoRootDefault(),
    target: "claude",
    mode: opts.mode ?? "symlink",
    force: true,
    syncClaudeCli: opts.claudeCliSync !== false
  });
  for (const line of lines) console.log(line);
  printBackendAvailability();
}
function uninstallAction(opts) {
  const target = opts.all ? "all" : "claude";
  const lines = uninstallHosts({ target });
  for (const line of lines) console.log(line);
}
function addInstallOptions(cmd) {
  return cmd.option("--claude", "Install for Claude", false).option("--all", "Alias for --claude", false).option("--mode <mode>", "Installation mode: symlink or copy", "symlink").option("--force", "Replace existing installation", false).option("--repo-root <path>", "Repository root path").option("--no-claude-cli-sync", "Skip Claude CLI sync");
}
function addUpdateOptions(cmd) {
  return cmd.option("--mode <mode>", "Installation mode: symlink or copy", "symlink").option("--repo-root <path>", "Repository root path").option("--no-claude-cli-sync", "Skip Claude CLI sync");
}
function addUninstallOptions(cmd) {
  return cmd.option("--claude", "Uninstall for Claude", false).option("--all", "Alias for --claude", false);
}
async function run(argv) {
  const normalized = normalizeArgv(argv);
  let exitCode = 0;
  if (normalized.length === 0) {
    const paths = configPaths();
    if (!existsSync5(paths.user)) {
      console.log("");
      console.log(banner("AI coding agent relay"));
      console.log("");
      console.log(`  ${theme.warning("No backends configured yet.")}`);
      console.log(`  Run ${theme.bold("phone-a-friend setup")} to get started.`);
      console.log("");
      console.log(`  ${theme.hint("Or jump straight in (requires codex in PATH):")}`);
      console.log(`    ${theme.info('phone-a-friend --to codex --prompt "What does this project do?"')}`);
      console.log("");
      return 0;
    }
  }
  const program2 = new Command().name("phone-a-friend").version(`phone-a-friend ${getVersion()}`, "-V, --version").description("CLI relay for AI coding agent collaboration").addHelpText("before", `
${banner("AI coding agent relay")}
`).configureOutput({
    writeOut: (str) => console.log(str.trimEnd()),
    writeErr: (str) => console.error(str.trimEnd())
  }).exitOverride();
  program2.command("relay").description("Relay prompt/context to a coding backend (default)").requiredOption("--prompt <text>", "Prompt to relay").option("--to <backend>", "Target backend: codex, gemini, ollama, openai").option("--repo <path>", "Repository path", process.cwd()).option("--context-file <path>", "File with additional context").option("--context-text <text>", "Inline context text").option("--include-diff", "Append git diff to prompt").option("--timeout <seconds>", "Max runtime in seconds").option("--model <name>", "Model override").option("--sandbox <mode>", "Sandbox: read-only, workspace-write, danger-full-access").action((opts) => {
    const resolved = resolveConfig({
      to: opts.to,
      sandbox: opts.sandbox,
      timeout: opts.timeout,
      includeDiff: opts.includeDiff !== void 0 ? String(opts.includeDiff) : void 0,
      model: opts.model
    });
    const backendName = resolved.backend;
    const spinner = ora({
      text: `Relaying to ${theme.bold(backendName)}...`,
      spinner: "dots",
      color: "cyan",
      stream: process.stderr
    }).start();
    try {
      const feedback = relay({
        prompt: opts.prompt,
        repoPath: opts.repo,
        backend: backendName,
        contextFile: opts.contextFile ?? null,
        contextText: opts.contextText ?? null,
        includeDiff: resolved.includeDiff,
        timeoutSeconds: resolved.timeout,
        model: resolved.model ?? null,
        sandbox: resolved.sandbox
      });
      spinner.succeed(`${theme.bold(backendName)} responded`);
      process.stdout.write(feedback + "\n");
    } catch (err) {
      spinner.fail(`${theme.bold(backendName)} failed`);
      throw err;
    }
  });
  program2.command("setup").description("Interactive setup wizard").action(async () => {
    await setup();
  });
  program2.command("doctor").description("Health check all backends").option("--json", "Output structured JSON", false).action(async (opts) => {
    const result = await doctor({ json: opts.json, repoRoot: process.cwd() });
    console.log(result.output);
    exitCode = result.exitCode;
  });
  const configCmd = program2.command("config").description("Manage configuration");
  configCmd.command("init").description("Create default config file").option("--force", "Overwrite existing config", false).action((opts) => {
    const paths = configPaths(process.cwd());
    configInit(paths.user, opts.force);
    console.log(`Config created at ${paths.user}`);
  });
  configCmd.command("show").description("Show resolved configuration").option("--sources", "Show which file each value comes from", false).action((opts) => {
    const config = loadConfig(process.cwd());
    if (opts.sources) {
      const paths = configPaths(process.cwd());
      console.log(`User config: ${paths.user}`);
      if (paths.repo) console.log(`Repo config: ${paths.repo}`);
      console.log("");
    }
    console.log(JSON.stringify(config, null, 2));
  });
  configCmd.command("paths").description("Print all config file paths").action(() => {
    const paths = configPaths(process.cwd());
    console.log(`User: ${paths.user}`);
    if (paths.repo) {
      console.log(`Repo: ${paths.repo}`);
    } else {
      console.log("Repo: (none)");
    }
  });
  configCmd.command("edit").description("Open user config in $EDITOR").action(() => {
    const paths = configPaths(process.cwd());
    const editor = process.env.EDITOR ?? "vi";
    if (!existsSync5(paths.user)) {
      configInit(paths.user, true);
    }
    spawnSync(editor, [paths.user], { stdio: "inherit" });
  });
  configCmd.command("set <key> <value>").description("Set a config value (dot-notation)").action((key, value) => {
    const paths = configPaths(process.cwd());
    if (!existsSync5(paths.user)) {
      configInit(paths.user, true);
    }
    configSet(key, value, paths.user);
    console.log(`Set ${key} = ${value}`);
  });
  configCmd.command("get <key>").description("Get a config value").action((key) => {
    const config = loadConfig(process.cwd());
    const value = configGet(key, config);
    if (value === void 0) {
      console.log(`(not set)`);
    } else {
      console.log(String(value));
    }
  });
  const pluginCmd = program2.command("plugin").description("Manage host integrations");
  addInstallOptions(
    pluginCmd.command("install").description("Install as Claude Code plugin")
  ).action((opts) => installAction(opts));
  addUpdateOptions(
    pluginCmd.command("update").description("Update Claude plugin")
  ).action((opts) => updateAction(opts));
  addUninstallOptions(
    pluginCmd.command("uninstall").description("Uninstall Claude plugin")
  ).action((opts) => uninstallAction(opts));
  addInstallOptions(
    program2.command("install").description("Install Claude plugin (alias for: plugin install)")
  ).action((opts) => installAction(opts));
  addUpdateOptions(
    program2.command("update").description("Update Claude plugin (alias for: plugin update)")
  ).action((opts) => updateAction(opts));
  addUninstallOptions(
    program2.command("uninstall").description("Uninstall Claude plugin (alias for: plugin uninstall)")
  ).action((opts) => uninstallAction(opts));
  try {
    await program2.parseAsync(normalized, { from: "user" });
  } catch (err) {
    if (err instanceof RelayError || err instanceof InstallerError) {
      console.error("");
      console.error(`  ${theme.crossmark} ${theme.error(err.message)}`);
      if (err.message.includes("too large")) {
        console.error(`  ${theme.hint("Try reducing the size of your input or context.")}`);
      }
      if (err.message.includes("depth limit")) {
        console.error(`  ${theme.hint("Agents are calling each other recursively.")}`);
      }
      console.error("");
      return 1;
    }
    if (err && typeof err === "object" && "exitCode" in err) {
      return err.exitCode;
    }
    if (err instanceof Error) {
      console.error(err.message);
      return 1;
    }
    throw err;
  }
  return exitCode;
}

// src/index.ts
run(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
/*! Bundled license information:

smol-toml/dist/error.js:
smol-toml/dist/util.js:
smol-toml/dist/date.js:
smol-toml/dist/primitive.js:
smol-toml/dist/extract.js:
smol-toml/dist/struct.js:
smol-toml/dist/parse.js:
smol-toml/dist/stringify.js:
smol-toml/dist/index.js:
  (*!
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
   *)
*/
