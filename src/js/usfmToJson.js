/* eslint-disable no-use-before-define,no-negated-condition,brace-style */
/**
 * @description for converting from USFM to json format.  Main method is usfmToJSON()
 */

import * as USFM from './USFM';

const VERSE_SPAN_REGEX = /(^-\d+\s)/;
const NUMBER = /(\d+)/;

/**
 * @description - Finds all of the regex matches in a string
 * @param {String} string - the string to find matches in
 * @param {RegExp} regex - the RegExp to find matches with, must use global flag /.../g
 * @param {Boolean} lastLine - true if last line of file
 * @return {Array} - array of results
*/
const getMatches = (string, regex, lastLine) => {
  let matches = [];
  let match;
  if (string.match(regex)) { // check so you don't get caught in a loop
    while ((match = regex.exec(string))) {
      // preserve white space
      let nextChar = null;
      const endPos = match.index + match[0].length;
      if (!lastLine && (endPos >= string.length)) {
        nextChar = "\n"; // save new line
      } else {
        let char = string[endPos];
        if (char === ' ') {
          nextChar = char; // save space
        }
      }
      if (nextChar) {
        match.nextChar = nextChar;
      }
      matches.push(match);
    }
  }
  return matches;
};

/**
 * @description - Parses the marker that opens and describes content
 * @param {String} markerOpen - the string that contains the marker '\v 1', '\p', ...
 * @return {Object} - the object of tag and number if it exists
*/
const parseMarkerOpen = markerOpen => {
  let object = {};
  if (markerOpen) {
    const regex = /(\+?\w+)\s*(\d*)/g;
    const matches = getMatches(markerOpen, regex, true);
    object = {
      tag: matches[0][1],
      number: matches[0][2]
    };
  }
  return object;
};

/**
 * @description - trim a leading space
 * @param {String} text - text to trim
 * @return {String} trimmed string
 */
const removeLeadingSpace = text => {
  if (text && (text.length > 1) && (text[0] === " ")) {
    text = text.substr(1);
  }
  return text;
};

/**
 * @description - Parses the word marker into word object
 * @param {object} state - holds parsing state information
 * @param {String} wordContent - the string to find the data/attributes
 * @return {Object} - object of the word attributes
*/
const parseWord = (state, wordContent) => {
  let object = {};
  const wordParts = (wordContent || "").split('|');
  const word = wordParts[0].trim();
  const attributeContent = wordParts[1];
  object = {
    text: word,
    tag: 'w',
    type: 'word'
  };
  if (state.params["content-source"]) {
    object["content-source"] = state.params["content-source"];
  }
  if (attributeContent) {
    const regex = /[x-]*([\w-]+)=['"](.*?)['"]/g;
    const matches = getMatches(attributeContent, regex, true);
    matches.forEach(function(match) {
      let key = match[1];
      if (key === "strongs") { // fix invalid 'strongs' key
        key = "strong";
      }
      if (state.params.map && state.params.map[key]) { // see if we should convert this key
        key = state.params.map[key];
      }
      let value = match[2];
      if (state.params.convertToInt &&
        (state.params.convertToInt.includes(key))) {
        value = parseInt(value, 10);
      }
      object[key] = value;
    });
  }
  return object;
};

/**
 * @description - make a marker object that contains the text
 * @param {string} text - text to embed in object
 * @return {{content: *}} new text marker
 */
const makeTextMarker = text => {
  return {
    content: text
  };
};

/**
 * @description create marker object from text
 * @param {String} text - text to put in marker
 * @return {object} new marker
 */
const createMarkerFromText = text => {
  return {
    open: text,
    tag: text
  };
};

/**
 * @description - Parses the line and determines what content is in it
 * @param {String} line - the string to find the markers and content
 * @param {Boolean} lastLine - true if last line of file
 * @return {Array} - array of objects that describe open/close and content
*/
const parseLine = (line, lastLine) => {
  let array = [];
  if (line.trim() === '') {
    if (!lastLine) {
      const object = makeTextMarker(line + '\n');
      array.push(object);
    }
    return array;
  }
  const regex = /([^\\]+)?\\(\+?\w+\s*\d*)(?!\w)\s*([^\\]+)?(\\\w\*)?/g;
  const matches = getMatches(line, regex, lastLine);
  let lastObject = null;
  if (regex.exec(line)) { // normal formatting with marker followed by content
    for (let match of matches) {
      const orphan = match[1];
      if (orphan) {
        const object = {content: orphan};
        array.push(object);
      }
      const open = match[2] ? match[2].trim() : undefined;
      const content = match[3] || undefined;
      const close = match[4] ? match[4].trim() : undefined;
      let marker = parseMarkerOpen(open);
      let object = {
        open: open,
        tag: marker.tag,
        number: marker.number,
        content: content
      };

      const whiteSpaceInOpen = (open !== match[2]);
      if (whiteSpaceInOpen && !marker.number) {
        const shouldMatch = '\\' + open + (content ? ' ' + content : "");
        if ((removeLeadingSpace(match[0]) !== shouldMatch)) { // look for dropped inside white space
          const endPos = match.index + match[0].length;
          const lineLength = line.length;
          const runToEnd = endPos >= lineLength;
          if (runToEnd) {
            object.content = match[2].substr(open.length) + (content || "");
          }
        }
      }

      if (marker.number && !USFM.markerSupportsNumbers(marker.tag)) { // this tag doesn't have number, move to content
        delete object.number;
        let newContent;
        const tagPos = match[0].indexOf(marker.tag);
        if (tagPos >= 0) {
          newContent = match[0].substr(tagPos + marker.tag.length + 1);
        } else {
          newContent = marker.number + ' ' + (content || "");
        }
        object.content = newContent;
      }
      if (close) {
        array.push(object);
        const closeTag = close.substr(1);
        object = createMarkerFromText(closeTag);
      }
      if (match.nextChar) {
        object.nextChar = match.nextChar;
      }
      array.push(object);
      lastObject = object;
    }
    // check for leftover text at end of line
    if (matches.length) {
      const lastMatch = matches[matches.length - 1];
      const endPos = lastMatch.index + lastMatch[0].length;
      if (endPos < line.length) {
        let orphanText = line.substr(endPos) + '\n';
        if (lastObject && lastObject.nextChar &&
          (lastObject.nextChar === ' ')) {
          orphanText = orphanText.substr(1); // remove first space since already handled
        }
        const object = makeTextMarker(orphanText);
        array.push(object);
      }
    }
  } else { // doesn't have a marker but may have content
    // this is considered an orphaned line
    const object = makeTextMarker(line + '\n');
    array.push(object);
  }
  return array;
};

/**
 * get top phrase if doing phrase (milestone)
 * @param {object} state - holds parsing state information
 * @return {object} location to add to phrase or null
 */
const getLastPhrase = state => {
  if ((state.phrase !== null) && (state.phrase.length > 0)) {
    return state.phrase[state.phrase.length - 1];
  }
  return null;
};

/**
 * @description - get location for chapter/verse, if location doesn't exist, create it.
 * @param {object} state - holds parsing state information
 * @return {array} location to place verse content
 */
const getSaveToLocation = state => {
  const phrase = getLastPhrase(state);
  if (phrase !== null) {
    return phrase;
  }

  if (state.params.chunk) {
    if (!state.verses[state.currentVerse]) {
      state.verses[state.currentVerse] = [];
    }
    return state.verses[state.currentVerse];
  }

  if (!state.currentVerse) {
    state.currentVerse = 'front';
  }
  if (!state.chapters[state.currentChapter][state.currentVerse])
    state.chapters[state.currentChapter][state.currentVerse] = [];

  return state.chapters[state.currentChapter][state.currentVerse];
};

/**
 * @description - create a USFM object with fields passed
 * @param {string|null} tag - string to use for tag
 * @param {string|null} number - optional number attribute
 * @param {string} content - optional content (may be saved as content or text depending on tag)
 * @return {{tag: *}} USFM object
 */
const createUsfmObject = (tag, number, content) => {
  const output = { };
  let contentAttr;
  if (tag) {
    output.tag = tag;
    let type = USFM.markerType(tag);
    if (type) {
      output.type = type;
    }
    const isContentText = USFM.isContentDisplayable(tag);
    contentAttr = isContentText ? 'text' : 'content';
    if (isContentText && USFM.markerHasAttributes(tag)) {
      const pos = content.indexOf('|');
      if (pos >= 0) {
        output.attrib = content.substr(pos);
        content = content.substr(0, pos);
      }
    }
  } else { // default to text type
    contentAttr = output.type = "text";
  }
  if (number) {
    if (USFM.markerSupportsNumbers(tag)) {
      output.number = number;
    } else { // handle rare case that parser places part of content as number
      let newContent = number;
      if (content) {
        newContent += ' ' + content;
      }
      content = newContent;
    }
  }
  if (content) {
    output[contentAttr] = content;
  }
  return output;
};

/**
 * @description push usfm object to array, and concat strings of last array item is also string
 * @param {object} state - holds parsing state information
 * @param {array} saveTo - location to place verse content
 * @param {object|string} usfmObject - object that contains usfm marker, or could be raw text
 */
const pushObject = (state, saveTo, usfmObject) => {
  if (!Array.isArray(saveTo)) {
    const phrase = getLastPhrase(state);
    if (phrase === null) {
      const isNestedMarker = state.nested.length > 0;
      if (isNestedMarker) { // if this marker is nested in another marker, then we need to add to content as string
        const last = state.nested.length - 1;
        const contentAttr = USFM.isContentDisplayable(usfmObject.tag) ? 'text' : 'content';
        const lastObject = state.nested[last];
        let output = lastObject[contentAttr];
        if (typeof usfmObject === "string") {
          output += usfmObject;
        } else {
          output += '\\' + usfmObject.tag;
          const content = usfmObject.text || usfmObject.content;
          if (content) {
            if (content[0] !== ' ') {
              output += ' ';
            }
            output += content;
          }
        }
        lastObject[contentAttr] = output;
        return;
      }
    } else {
      saveTo = phrase;
    }
  }

  if (typeof usfmObject === "string") { // if raw text, convert to object
    if (usfmObject === '') { // skip empty strings
      return;
    }
    usfmObject = createUsfmObject(null, null, usfmObject);
  }

  saveTo = Array.isArray(saveTo) ? saveTo : getSaveToLocation(state);
  if (saveTo.length && (usfmObject.type === "text")) {
    // see if we can append to previous string
    const lastPos = saveTo.length - 1;
    let lastObject = saveTo[lastPos];
    if (lastObject.type === "text") {
      lastObject.text += usfmObject.text;
      return;
    }
  }
  saveTo.push(usfmObject);
};

/**
 * @description test if last character was newline (or return) char
 * @param {String} line - line to test
 * @return {boolean} true if newline
 */
const isLastCharNewLine = line => {
  const lastChar = (line) ? line.substr(line.length - 1) : '';
  const index = ['\n', '\r'].indexOf(lastChar);
  return index >= 0;
};

/**
 * @description test if next to last character is quote
 * @param {String} line - line to test
 * @return {boolean} true if newline
 */
const isNextToLastCharQuote = line => {
  const nextToLastChar = (line && (line.length >= 2)) ? line.substr(line.length - 2, 1) : '';
  const index = ['"', '“'].indexOf(nextToLastChar);
  return index >= 0;
};

/**
 * @description - remove previous new line from text
 * @param {object} state - holds parsing state information
 * @param {boolean} ignoreQuote - if true then don't remove last new line if preceded by quote.
 */
const removeLastNewLine = (state, ignoreQuote = false) => {
  const saveTo = getSaveToLocation(state);
  if (saveTo && saveTo.length) {
    const lastObject = saveTo[saveTo.length - 1];
    if (lastObject.type === 'text') {
      const text = lastObject.text;
      if (isLastCharNewLine((text))) {
        const removeNewLine = !ignoreQuote || !isNextToLastCharQuote(text);
        if (removeNewLine) {
          if (text.length === 1) {
            saveTo.pop();
          } else {
            lastObject.text = text.substr(0, text.length - 1);
          }
        }
      }
    }
  }
};

/**
 * @description - rollback nested to endpoint for this tag
 * @param {object} state - holds parsing state information
 * @param {String} content - usfm marker content
 * @param {String} tag - usfm marker tag
 * @param {string} nextChar - next character after marker
 * @param {string} endTag - end suffix
 */
const unPopNestedMarker = (state, content, tag, nextChar, endTag) => {
  let extra = content.substr(1); // pull out data after end marker
  if (tag.substr(tag.length - endTag.length) === endTag) {
    tag = tag.substr(0, tag.length - endTag.length);
  }
  let found = false;
  for (let j = state.nested.length - 1; j >= 0; j--) {
    let beginning = state.nested[j];
    const stackTYpe = beginning.tag;
    if (tag === stackTYpe) {
      while (state.nested.length > j) { // rollback nested to this point
        state.nested.pop();
      }
      beginning.endTag = endTag;
      found = true;
      break;
    }
  }
  if (!found) { // since nested and not in stack, add end marker to text content
    pushObject(state, null, '\\' + tag + '*');
  }
  if (extra) {
    pushObject(state, null, extra);
  }
  if (nextChar) {
    pushObject(state, null, nextChar);
  }
};

/**
 * @description normalize the numbers in string by removing leading '0'
 * @param {string} text - number string to normalize
 * @return {string} normalized number string
 */
const stripLeadingZeros = text => {
  while ((text.length > 1) && (text[0] === '0')) {
    text = text.substr(1);
  }
  return text;
};

/**
 * check if object is an end marker
 * @param {object} usfmObject - object to check
 * @param {string} tag - tag for object
 * @return {{endMarker: (null|string), content: (string), spannedUsfm: (boolean)}} return new values
 */
const checkForEndMarker = (usfmObject, tag) => {
  let spannedUsfm = false;
  let endMarker = null;
  let content = usfmObject.content || "";
  const baseTag = (tag[tag.length - 1] === "*") ? tag.substr(0, tag.length - 1) : tag;
  let terminations = USFM.markerTermination(baseTag);
  if (terminations) {
    spannedUsfm = true;
    if (typeof terminations === 'string') {
      terminations = [terminations];
    }
    const length = terminations.length;
    for (let i = 0; i < length; i++) {
      const termination = terminations[i];
      let termLength = termination.length;
      if ((content && (content.substr(0, termLength) === termination)) ||
        (tag.substr(tag.length - termLength) === termination)) {
        endMarker = baseTag + termination;
        break;
      }
    }
  }
  return {endMarker, content, spannedUsfm};
};

/**
 * @description - save the usfm object to specified place and handle nested data
 * @param {object} state - holds parsing state information
 * @param {String} tag - usfm marker tag
 * @param {object} usfmObject - object that contains usfm marker
 */
const saveUsfmObject = (state, tag, usfmObject) => {
  const phraseParent = getPhraseParent(state);
  if (phraseParent) {
    if (!USFM.isContentDisplayable(phraseParent.tag)) {
      const objectText = (typeof usfmObject === 'string') ? usfmObject : markerToText(usfmObject);
      phraseParent.content = (phraseParent.content || "") + objectText;
    }
  } else if (state.nested.length > 0) { // is nested object
    pushObject(state, null, usfmObject);
  } else { // not nested
    const saveTo = getSaveToLocation(state);
    const usfmObject_ = (typeof usfmObject === 'string') ?
      createUsfmObject(null, null, usfmObject) : usfmObject;
    saveTo.push(usfmObject_);
  }
};

/**
 * keeps nesting count if of same type
 * @param {object} state - holds parsing state information
 * @param {object} phraseParent - object adding to
 * @param {string} tag - tag for verseObject
 * @return {boolean} true if match
 */
const incrementPhraseNesting = (state, phraseParent, tag) => {
  if (phraseParent && (phraseParent.tag === tag)) {
    if (!phraseParent.nesting) {
      phraseParent.nesting = 0;
    }
    phraseParent.nesting++;
    return true;
  }
  return false;
};

/**
 * keeps nesting count if of same type
 * @param {object} state - holds parsing state information
 * @param {object} phraseParent - object adding to
 * @param {string} endTag - tag for verseObject
 * @return {{matchesParent: (boolean), count: (number)}} return new values
 */
const decrementPhraseNesting = (state, phraseParent, endTag) => {
  let matchesParent = false;
  let count = -1;
  if (phraseParent) {
    let terminations = USFM.markerTermination(phraseParent.tag);
    if (terminations) {
      if (typeof terminations === 'string') {
        terminations = [terminations];
      }
      const length = terminations.length;
      for (let i = 0; i < length; i++) {
        const termination = terminations[i];
        matchesParent = (termination === endTag) ||
          (phraseParent.tag + termination === endTag);
        if (matchesParent) {
          break;
        }
      }
    }
    if (!matchesParent &&
      (USFM.SPECIAL_END_TAGS[endTag] === phraseParent.tag)) {
      matchesParent = true;
    }
    if (matchesParent) {
      count = phraseParent.nesting || 0;
      if (count) {
        phraseParent.nesting = --count;
      }
      if (!count) {
        delete phraseParent.nesting;
      }
    }
  }
  return {matchesParent, count};
};

/**
 * mark the beginning of a spanned usfm
 * @param {object} state - holds parsing state information
 * @param {object} marker - verseObject to save
 * @param {string} tag - tag for verseObject
 */
const startSpan = (state, marker, tag) => {
  marker.tag = tag;
  const phraseParent = getPhraseParent(state);
  if (phraseParent) {
    if (!USFM.isContentDisplayable(phraseParent.tag)) {
      phraseParent.content = (phraseParent.content || "") + markerToText(marker);
      incrementPhraseNesting(state, phraseParent, tag);
      return;
    }
  }
  if (USFM.isContentDisplayable(tag)) { // we need to nest
    pushObject(state, null, marker);
    if (state.phrase === null) {
      state.phrase = []; // create new phrase stack
      state.phraseParent = marker;
    }
    state.phrase.push([]); // push new empty list onto phrase stack
    marker.children = getLastPhrase(state); // point to top of phrase stack
  } else {
    saveUsfmObject(state, tag, marker);
    if (state.phrase === null) {
      let last = getSaveToLocation(state);
      if (last && last.length) {
        last = last[last.length - 1];
      }
      state.phrase = []; // create new phrase stack
      state.phrase.push([]); // push new empty list onto phrase stack
      state.phraseParent = last;
    }
    incrementPhraseNesting(state, marker, tag);
  }
};

/**
 * get parent of current phrase
 * @param {object} state - holds parsing state information
 * @return {Object} parent
 */
const getPhraseParent = state => {
  let parent = null;
  if ((state.phrase !== null) && (state.phrase.length > 1)) {
    parent = state.phrase[state.phrase.length - 2];
  }
  if (parent) {
    if (parent.length > 0) {
      parent = parent[parent.length - 1]; // get last in array
    } else {
      parent = null;
    }
  }
  if (!parent) {
    parent = state.phraseParent;
  }
  return parent;
};

/**
 * pop and return last phrase
 * @param {object} state - holds parsing state information
 * @return {object} last phrase
 */
const popPhrase = state => {
  let last = null;
  if (state.phrase && (state.phrase.length > 0)) {
    state.phrase.pop(); // remove last phrases
    if (state.phrase.length <= 0) {
      state.phrase = null; // stop adding to phrases
      last = state.phraseParent;
      state.phraseParent = null;
    } else {
      last = getPhraseParent(state);
    }
  } else {
    state.phraseParent = null;
  }
  return last;
};

/**
 * end a spanned usfm
 * @param {object} state - holds parsing state information
 * @param {number} index - current position in markers
 * @param {array} markers - parsed markers we are iterating through
 * @param {string} endMarker - end marker for phrase
 * @return {number} new index
 */
const endSpan = (state, index, markers, endMarker) => {
  let current = markers[index];
  let content = current.content;
  let phraseParent = getPhraseParent(state);
  const parentContentDisplayable = USFM.isContentDisplayable(phraseParent.tag);
  if (!phraseParent || parentContentDisplayable) {
    popPhrase(state);
    if (phraseParent && endMarker) {
      phraseParent.endTag = endMarker;
      if ((phraseParent.children !== undefined) &&
            !phraseParent.children.length) {
        delete phraseParent.children; // remove unneeded empty children
      }
    }
  }
  if (content) {
    let trimLength = 0;
    if ((content.substr(0, 2) === "\\*")) { // check if content is part of milestone end
      trimLength = 2;
    }
    else if ((content[0] === "*")) { // check if content is part of milestone end
      trimLength = 1;
    }
    else if ((content.substr(0, 4) === "-e\\*")) { // check if content marker is part of milestone end
      trimLength = 4;
    }
    else if ((content.substr(0, 3) === "-e*")) { // check if content marker is part of milestone end
      trimLength = 3;
    }
    else if ((content === "-e")) { // check if content + next marker is part of milestone end
      if ((index + 1) < markers.length) {
        const nextItem = markers[index + 1];
        let type = "content";
        let nextContent = nextItem.content;
        if (!nextContent && nextItem.text) {
          type = "text";
          nextContent = nextItem.text;
        }
        if ((nextContent.substr(0, 1) === "*")) { // check if content is part of milestone end
          trimLength = 1;
        }
        else if ((nextContent.substr(0, 2) === "\\*")) { // check if content is part of milestone end
          trimLength = 2;
        }
        if (trimLength) {
          if (nextContent.substr(trimLength, 1) === '\n') {
            trimLength++;
          }
          content = '';
          nextContent = nextContent.substr(trimLength);
          nextItem[type] = nextContent;
          trimLength = 0;
        }
        if ((type === "content") && !nextContent) {
          index++;
        }
      }
    }
    if (trimLength) {
      if (content.substr(trimLength, 1) === '\n') {
        trimLength++;
      }
      content = content.substr(trimLength); // remove phrase end marker
    }
  }
  if (current && current.nextChar) {
    if (content) {
      content += current.nextChar;
      delete current.nextChar;
    }
  }
  if (phraseParent) {
    let endMarker_ = "\\" + endMarker;
    const {matchesParent, count} =
      decrementPhraseNesting(state, phraseParent, endMarker);
    const finishPhrase = matchesParent && (count <= 0);
    if (!parentContentDisplayable) {
      let nextChar = current && current.nextChar;
      if (content && nextChar) {
        content += nextChar;
        nextChar = '';
      }
      if (!finishPhrase) {
        phraseParent.content = (phraseParent.content || "") +
            endMarker_ + (nextChar || "");
      } else {
        phraseParent.endTag = endMarker;
        if (nextChar) {
          phraseParent.nextChar = nextChar;
        }
        popPhrase(state);
      }
    } else if (finishPhrase) { // parent displayable and this finishes
      phraseParent.endTag = endMarker;
      if (current && current.nextChar) {
        phraseParent.nextChar = current.nextChar;
      }
    }
  }
  if (content) {
    saveUsfmObject(state, null, content);
  }
  return index;
};

/**
 * @description - adds usfm object to current verse and handles nested USFM objects
 * @param {object} state - holds parsing state information
 * @param {object} usfmObject - object that contains usfm marker
 * @param {boolean} span - true if starting usfm span
 */
const addToCurrentVerse = (state, usfmObject, span = false) => {
  let tag = usfmObject.tag;
  if (!tag) {
    pushObject(state, null, usfmObject);
    return;
  }
  let content = usfmObject.content || "";
  if (usfmObject.nextChar && !usfmObject.close) {
    content += usfmObject.nextChar;
  }
  const output = createUsfmObject(tag, null, content);
  if (span) {
    startSpan(state, output, tag);
  } else {
    saveUsfmObject(state, tag, output);
  }
};

/**
 * @description - process marker as a verse
 * @param {object} state - holds parsing state information
 * @param {object} marker - marker object containing content
 */
const parseAsVerse = (state, marker) => {
  state.nested = [];
  marker.content = marker.content || "";
  if (marker.nextChar === "\n") {
    marker.content += marker.nextChar;
  }
  state.currentVerse = stripLeadingZeros(marker.number);

  // check for verse span
  const spanMatch = VERSE_SPAN_REGEX.exec(marker.content);
  if (spanMatch) {
    state.currentVerse += spanMatch[0][0] +
      stripLeadingZeros(spanMatch[0].substr(1).trim());
    marker.content = marker.content.substr(spanMatch[0].length);
  }

  if (state.params.chunk && !state.onSameChapter) {
    if (state.verses[state.currentVerse]) {
      state.onSameChapter = true;
    } else {
      state.verses[state.currentVerse] = [];
      pushObject(state, null, marker.content);
    }
  } else if (state.chapters[state.currentChapter] && !state.onSameChapter) {
    // if the current chapter exists, not on same chapter, and there is content to store
    if (state.chapters[state.currentChapter][state.currentVerse]) {
      // If the verse already exists, then we are flagging as 'on the same chapter'
      state.onSameChapter = true;
    } else {
      pushObject(state, null, marker.content);
    }
  }
};

/**
 * @description - process marker as text
 * @param {object} state - holds parsing state information
 * @param {object} marker - marker object containing content
 */
const processAsText = (state, marker) => {
  if (state.currentChapter > 0 && marker.content) {
    addToCurrentVerse(state, marker.content);
  } else if (state.currentChapter === 0 && !state.currentVerse) { // if we haven't seen chapter yet, its a header
    pushObject(state, state.headers, createUsfmObject(marker.tag,
          marker.number, marker.content));
  }
  if (state.params.chunk && state.currentVerse > 0 && marker.content) {
    if (!state.verses[state.currentVerse])
      state.verses[state.currentVerse] = [];
    if (getPhraseParent(state)) {
      saveUsfmObject(state, null, marker.content);
    } else {
      pushObject(state, state.verses[state.currentVerse], marker.content);
    }
  }
};

/**
 * @description - convert marker to text
 * @param {object} marker - object to convert to text
 * @return {string} text representation of marker
 */
const markerToText = marker => {
  let text = '\\' + marker.tag;
  if (marker.number) {
    text += " " + marker.number;
  }
  text += (marker.content ? " " + marker.content : "");
  text += (marker.text ? " " + marker.text : "");
  if (marker.nextChar) {
    text += marker.nextChar;
  }
  return text;
};

/**
 * @description - process marker as a chapter
 * @param {object} state - holds parsing state information
 * @param {object} marker - marker object containing content
 */
const processAsChapter = (state, marker) => {
  state.nested = [];
  state.currentChapter = stripLeadingZeros(marker.number);
  state.chapters[state.currentChapter] = {};
  // resetting 'on same chapter' flag
  state.onSameChapter = false;
  state.currentVerse = 0;
};

/**
 * @description - see if verse number in content
 * @param {object} marker - marker object containing content
 */
const extractNumberFromContent = marker => {
  const numberMatch = NUMBER.exec(marker.content);
  if (numberMatch) {
    marker.number = numberMatch[0];
    marker.content = marker.content.substr(numberMatch.length);
  }
};

const getVerseObjectsForChapter = currentChapter => {
  const outputChapter = {};
  for (let verseNum of Object.keys(currentChapter)) {
    const verseObjects = currentChapter[verseNum];
    outputChapter[verseNum] = {
      verseObjects: verseObjects
    };
  }
  return outputChapter;
};

const getVerseObjectsForBook = (usfmJSON, state) => {
  usfmJSON.chapters = {};
  for (let chapterNum of Object.keys(state.chapters)) {
    const currentChapter = state.chapters[chapterNum];
    usfmJSON.chapters[chapterNum] = getVerseObjectsForChapter(currentChapter);
  }
};

/**
 * @description - Parses the usfm string and returns an object
 * @param {String} usfm - the raw usfm string
 * @param {Object} params - extra params to use for chunk parsing. Properties:
 *                    chunk {boolean} - if true then output is just a small piece of book
 *                    content-source {String} - content source attribute to add to word imports
 *                    convertToInt {Array} - attributes to convert to integer
 * @return {Object} - json object that holds the parsed usfm data, headers and chapters
*/
export const usfmToJSON = (usfm, params = {}) => {
  let lines = usfm.split(/\r?\n/); // get all the lines
  let usfmJSON = {};
  let markers = [];
  let lastLine = lines.length - 1;
  for (let i = 0; i < lines.length; i++) {
    const parsedLine = parseLine(lines[i], i >= lastLine);
    markers.push.apply(markers, parsedLine);
  }
  const state = {
    currentChapter: 0,
    currentVerse: 0,
    chapters: {},
    verses: {},
    headers: [],
    nested: [],
    phrase: null,
    phraseParent: null,
    onSameChapter: false,
    params: params
  };
  for (let i = 0; i < markers.length; i++) {
    let marker = markers[i];
    switch (marker.tag) {
      case 'c': { // chapter
        if (!marker.number && marker.content) { // if no number, try to find in content
          extractNumberFromContent(marker);
        }
        if (marker.number) {
          processAsChapter(state, marker);
        } else { // no chapter number, add as text
          marker.content = markerToText(marker);
          processAsText(state, marker);
        }
        break;
      }
      case 'v': { // verse
        if (!marker.number && marker.content) { // if no number, try to find in content
          extractNumberFromContent(marker);
        }
        if (marker.number) {
          parseAsVerse(state, marker);
        } else { // no verse number, add as text
          marker.content = markerToText(marker);
          processAsText(state, marker);
        }
        break;
      }
      case 'k':
      case 'zaln': { // phrase
        removeLastNewLine(state);
        const phrase = parseWord(state, marker.content); // very similar to word marker, so start with this and modify
        phrase.type = "milestone";
        const milestone = phrase.text.trim();
        if (milestone === '-s') { // milestone start
          delete phrase.text;
          startSpan(state, phrase, marker.tag);
        } else if (milestone === '-e') { // milestone end
          i = endSpan(state, i, markers, marker.tag + "-e\\*");
        }
        break;
      }
      case 'w': { // word
        removeLastNewLine(state, true);
        const wordObject = parseWord(state, marker.content);
        pushObject(state, null, wordObject);
        if (marker.nextChar) {
          pushObject(state, null, marker.nextChar);
        }
        break;
      }
      case 'w*': {
        if (marker.nextChar && (marker.nextChar !== ' ')) {
          pushObject(state, null, marker.nextChar);
        }
        break;
      }
      case undefined: { // likely orphaned text for the preceding verse marker
        processAsText(state, marker);
        break;
      }
      default: {
        const tag0 = marker.tag ? marker.tag.substr(0, 1) : "";
        if ((tag0 === 'v') || (tag0 === 'c')) { // check for mangled verses and chapters
          const number = marker.tag.substr(1);
          const isInt = /^\+?\d+$/.test(number);
          if (isInt) {
            // separate number from tag
            marker.tag = tag0;
            if (marker.number) {
              marker.content = marker.number +
                (marker.content ? " " + marker.content : "");
            }
            marker.number = number;
            if (tag0 === 'v') {
              parseAsVerse(state, marker);
              marker = null;
            } else if (tag0 === 'c') {
              processAsChapter(state, marker);
              marker = null;
            }
          } else if (marker.tag.length === 1) { // convert line to text
            marker.content = markerToText(marker);
            processAsText(state, marker);
            marker = null;
          }
        }
        if (marker) { // if not yet processed
          if (state.currentChapter === 0 && !state.currentVerse) { // if we haven't seen chapter yet, its a header
            pushObject(state, state.headers, createUsfmObject(marker.tag,
              marker.number, marker.content));
          } else if (state.currentChapter ||
            (state.params.chunk && state.currentVerse)) {
            let tag = marker.tag;
            let {endMarker, content, spannedUsfm} =
              checkForEndMarker(marker, tag);
            if (!endMarker && USFM.SPECIAL_END_TAGS[tag]) { // check for one-off end markers
              const startMarker = USFM.SPECIAL_END_TAGS[tag];
              endMarker = tag;
              tag = startMarker;
              spannedUsfm = true;
            }
            if (endMarker) { // check for end marker
              if (spannedUsfm) {
                i = endSpan(state, i, markers, endMarker);
              } else {
                unPopNestedMarker(state, content, tag, marker.nextChar,
                  endMarker);
              }
            } else {
              marker.tag = tag;
              addToCurrentVerse(state, marker, spannedUsfm);
            }
          }
        }
      }
    }
  }
  usfmJSON.headers = state.headers;
  getVerseObjectsForBook(usfmJSON, state);
  if (Object.keys(state.verses).length > 0) {
    usfmJSON.verses = getVerseObjectsForChapter(state.verses);
  }
  return usfmJSON;
};
