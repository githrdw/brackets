/*
 * Copyright (c) 2012 Adobe Systems Incorporated. All rights reserved.
 *  
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"), 
 * to deal in the Software without restriction, including without limitation 
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, 
 * and/or sell copies of the Software, and to permit persons to whom the 
 * Software is furnished to do so, subject to the following conditions:
 *  
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *  
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING 
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
 * DEALINGS IN THE SOFTWARE.
 * 
 */


// FUTURE: Merge part (or all) of this class with MultiRangeInlineEditor
/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, CodeMirror, window */

define(function (require, exports, module) {
    "use strict";

    // Load dependent modules
    var DocumentManager     = require("document/DocumentManager"),
        EditorManager       = require("editor/EditorManager"),
        CommandManager      = require("command/CommandManager"),
        Commands            = require("command/Commands"),
        InlineWidget        = require("editor/InlineWidget").InlineWidget;

    /**
     * Returns editor holder width (not CodeMirror's width).
     * @private
     */
    function _editorHolderWidth() {
        return $("#editor-holder").width();
    }

    /**
     * Shows or hides the dirty indicator
     * @private
     */
    function _showDirtyIndicator($indicatorDiv, isDirty) {
        // Show or hide the dirty indicator by adjusting
        // the width of the div.
        $indicatorDiv.css("width", isDirty ? 16 : 0);
    }
    
    /**
     * Respond to dirty flag change event. If the dirty flag is associated with an inline editor,
     * show (or hide) the dirty indicator.
     * @private
     */
    function _dirtyFlagChangeHandler(event, doc) {
        var $dirtyIndicators = $(".inlineEditorHolder .dirty-indicator"),
            $indicator;
        
        $.each($dirtyIndicators, function (index, indicator) {
            $indicator = $(indicator);
            if ($indicator.data("fullPath") === doc.file.fullPath) {
                _showDirtyIndicator($indicator, doc.isDirty);
            }
        });
    }
    
    /**
     * @constructor
     * @extends {InlineWidget}
     */
    function InlineTextEditor() {
        InlineWidget.call(this);

        /* @type {Array.<{Editor}>}*/
        this.editors = [];
    }
    InlineTextEditor.prototype = Object.create(InlineWidget.prototype);
    InlineTextEditor.prototype.constructor = InlineTextEditor;
    InlineTextEditor.prototype.parentClass = InlineWidget.prototype;
    
    InlineTextEditor.prototype.editors = null;

   /**
     * Given a host editor and its inline editors, find the widest gutter and make all the others match
     * @param {!Editor} hostEditor Host editor containing all the inline editors to sync
     * @private
     */
    function _syncGutterWidths(hostEditor) {
        var allHostedEditors = EditorManager.getInlineEditors(hostEditor);
        
        // add the host itself to the list too
        allHostedEditors.push(hostEditor);
        
        var maxWidth = 0;
        allHostedEditors.forEach(function (editor) {
            var $gutter = $(editor._codeMirror.getGutterElement());
            $gutter.css("min-width", "");
            var curWidth = $gutter.width();
            if (curWidth > maxWidth) {
                maxWidth = curWidth;
            }
        });
        
        if (allHostedEditors.length === 1) {
            //There's only the host, just bail
            allHostedEditors[0]._codeMirror.setOption("gutter", true);
            return;
        }
        
        maxWidth = maxWidth + "px";
        allHostedEditors.forEach(function (editor) {
            $(editor._codeMirror.getGutterElement()).css("min-width", maxWidth);
            editor._codeMirror.setOption("gutter", true);
        });
    }

    /**
     * Called any time inline was closed, whether manually (via close()) or automatically
     */
    InlineTextEditor.prototype.onClosed = function () {
        InlineTextEditor.prototype.parentClass.onClosed.apply(this, arguments);
            
        _syncGutterWidths(this.hostEditor);
        
        this.editors.forEach(function (editor) {
            editor.destroy(); //release ref on Document
        });
    };
    
    /**
     * Update the inline editor's height when the number of lines change.
     * @param {boolean} force the editor to resize
     */
    InlineTextEditor.prototype.sizeInlineWidgetToContents = function (force) {
        // brackets_codemirror_overrides.css adds height:auto to CodeMirror
        // Inline editors themselves do not need to be sized, but layouts like
        // the one used in CSSInlineEditor do need some manual layout.
        
        // Resize the editors to the content
        // TODO: only handles 1 editor right now. Add multiple editor support when
        // the design is finalized
        if (this.editors.length > 0 && force) {
            var editor = this.editors[0];
            
            if (editor.isFullyVisible()) {
                editor.refresh();
            }
        }
    };

    /**
     * Some tasks have to wait until we've been parented into the outer editor
     * @param {string} the inline ID that is generated by CodeMirror after the widget that holds the inline
     *  editor is constructed and added to the DOM
     */
    InlineTextEditor.prototype.onAdded = function () {
        InlineTextEditor.prototype.parentClass.onAdded.apply(this, arguments);
        
        this.editors.forEach(function (editor) {
            editor.refresh();
        });
        
        _syncGutterWidths(this.hostEditor);
        
        // Set initial size
        // Note that the second argument here (ensureVisibility) is only used by CSSInlineEditor.
        // FUTURE: Should clean up this API so it's consistent between the two.
        this.sizeInlineWidgetToContents(true, true);
        
        this.editors[0].focus();
    };

    /**
     *
     * @param {Document} doc
     * @param {number} startLine of text to show in inline editor
     * @param {number} endLine of text to show in inline editor
     * @param {HTMLDivElement} container container to hold the inline editor
     */
    InlineTextEditor.prototype.createInlineEditorFromText = function (doc, startLine, endLine, container, additionalKeys) {
        var self = this;
        
        var range = {
            startLine: startLine,
            endLine: endLine
        };
        
        // root container holding header & editor
        var $wrapperDiv = $("<div/>");
        var wrapperDiv = $wrapperDiv[0];
        
        // header containing filename, dirty indicator, line number
        var $header = $("<div/>").addClass("inline-editor-header");
        var $filenameInfo = $("<a/>").addClass("filename");
        
        // dirty indicator, with file path stored on it
        var $dirtyIndicatorDiv = $("<div/>")
            .addClass("dirty-indicator")
            .width(0); // initialize indicator as hidden
        $dirtyIndicatorDiv.data("fullPath", doc.file.fullPath);
        
        var $lineNumber = $("<span class='line-number'/>");

        // wrap filename & line number in clickable link with tooltip
        $filenameInfo.append($dirtyIndicatorDiv)
            .append(doc.file.name + " : ")
            .append($lineNumber)
            .attr("title", doc.file.fullPath);
        
        // clicking filename jumps to full editor view
        $filenameInfo.click(function () {
            CommandManager.execute(Commands.FILE_OPEN, { fullPath: doc.file.fullPath })
                .done(function () {
                    EditorManager.getCurrentFullEditor().setCursorPos(startLine);
                });
        });

        $header.append($filenameInfo);
        $wrapperDiv.append($header);
        
        
        // Create actual Editor instance
        var inlineInfo = EditorManager.createInlineEditorForDocument(doc, range, wrapperDiv, additionalKeys);
        this.editors.push(inlineInfo.editor);
        container.appendChild(wrapperDiv);

        var updateLineNumber = function () {
            var oldStartLine    = self._startLine,
                oldEndLine      = self._endLine,
                oldLineCount    = self._lineCount;

            self._updateLineStats(inlineInfo.editor);

            if (oldStartLine !== self._startLine) {
                $lineNumber.text(self._startLine + 1);
                return true;
            }

            return (oldLineCount !== self._lineCount);
        };
        updateLineNumber();

        // Size editor to content whenever text changes (via edits here or any other view of the doc: Editor
        // fires "change" any time its text changes, regardless of origin)
        $(inlineInfo.editor).on("change", function () {
            if (updateLineNumber()) {
                self.sizeInlineWidgetToContents(true);
                self.hostEditor.refresh();
            }
        });
        
        // If Document's file is deleted, or Editor loses sync with Document, delegate to this._onLostContent()
        $(inlineInfo.editor).on("lostContent", function () {
            self._onLostContent.apply(self, arguments);
        });
        
        // set dirty indicator state
        _showDirtyIndicator($dirtyIndicatorDiv, doc.isDirty);
    };

    InlineTextEditor.prototype._updateLineStats = function (editor) {
        this._startLine = editor.getFirstVisibleLine();
        this._endLine = editor.getLastVisibleLine();
        this._lineCount = this._endLine - this._startLine;
    };

    /**
     * @param {Editor} hostEditor
     */
    InlineTextEditor.prototype.load = function (hostEditor) {
        InlineTextEditor.prototype.parentClass.load.apply(this, arguments);

        // TODO: incomplete impelementation. It's not clear yet if InlineTextEditor
        // will fuction as an abstract class or as generic inline editor implementation
        // that just shows a range of text. See CSSInlineEditor.css for an implementation of load()
    };

    /**
     * Called when the editor containing the inline is made visible.
     */
    InlineTextEditor.prototype.onParentShown = function () {
        InlineTextEditor.prototype.parentClass.onParentShown.apply(this, arguments);

        // We need to call this explicitly whenever the host editor is reshown
        this.sizeInlineWidgetToContents(true);
    };
    
    InlineTextEditor.prototype._editorHasFocus = function () {
        return this.editors.some(function (editor) {
            return editor.hasFocus();
        });
    };
        
    /**
     * If Document's file is deleted, or Editor loses sync with Document, just close
     */
    InlineTextEditor.prototype._onLostContent = function () {
        // Note: this closes the entire inline widget if any one Editor loses sync. This seems
        // better than leaving it open but suddenly removing one rule from the result list.
        this.close();
    };
    
    // consolidate all dirty document updates
    $(DocumentManager).on("dirtyFlagChange", _dirtyFlagChangeHandler);

    exports.InlineTextEditor = InlineTextEditor;

});
