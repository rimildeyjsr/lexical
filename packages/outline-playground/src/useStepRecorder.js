/**
 *
 * @flow strict-local
 */

import type {OutlineEditor, View} from 'outline';

// $FlowFixMe
import {createPortal} from 'react-dom';
import {createTextNode} from 'outline';
import {createParagraphNode} from 'outline-extensions/ParagraphNode';

import {
  isDeleteBackward,
  isDeleteForward,
  isDeleteLineBackward,
  isDeleteLineForward,
  isDeleteWordBackward,
  isDeleteWordForward,
  isLineBreak,
  isParagraph,
  isBold,
  isItalic,
  isUndo,
  isRedo,
} from 'outline-react/OutlineHotKeys';

import useOutlineEvent from 'outline-react/useOutlineEvent';

import React, {useState, useCallback, useMemo, useRef, useEffect} from 'react';

// stolen from OutlineSelection-test
function sanitizeSelectionWithEmptyTextNodes(selection) {
  const {anchorNode, focusNode} = selection;
  if (anchorNode === focusNode && anchorNode.textContent === '\uFEFF') {
    return {anchorNode, focusNode, anchorOffset: 0, focusOffset: 0};
  }
  return selection;
}

function sanitizeHTML(html) {
  // Remove the special space characters
  return html.replace(/\uFEFF/g, '');
}

function getPathFromNodeToEditor(node: Node, editorElement) {
  let currentNode = node;
  const path = [];
  while (currentNode !== editorElement) {
    path.unshift(
      Array.from(currentNode?.parentNode?.childNodes ?? []).indexOf(
        currentNode,
      ),
    );
    currentNode = currentNode?.parentNode;
  }
  return path;
}

// $FlowFixMe TODO
type Steps = Array<any>;

const AVAILABLE_INPUTS = {
  deleteBackward: isDeleteBackward,
  deleteForward: isDeleteForward,
  deleteWordBackward: isDeleteWordBackward,
  deleteWordForward: isDeleteWordForward,
  deleteLineForward: isDeleteLineForward,
  deleteLineBackward: isDeleteLineBackward,
  insertParagraph: isParagraph,
  insertLinebreak: isLineBreak,
  undo: isUndo,
  redo: isRedo,
  formatBold: isBold,
  formatItalic: isItalic,
  moveBackward: (e) => e.key === 'ArrowLeft',
  moveForward: (e) => e.key === 'ArrowRight',
  // I imagine there's a smarter way of checking that it's not a special character.
  // this serves to filter out selection inputs like `ArrowLeft` etc that we handle elsewhere
  insertText: (e) => e.key.length === 1,
};

export default function useStepRecorder(editor: OutlineEditor): React$Node {
  const [steps, setSteps] = useState<Steps>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [currentInnerHTML, setCurrentInnerHTML] = useState('');
  const previousSelectionRef = useRef(null);
  const currentEditorRef = useRef(editor);
  const skipNextSelectionChangeRef = useRef(false);

  useEffect(() => {
    currentEditorRef.current = editor;
  }, [editor]);

  const getCurrentEditor = useCallback(() => {
    return currentEditorRef.current;
  }, []);

  // just a wrapper around inserting new actions so that we can
  // coalesce some actions like insertText/moveNativeSelection
  const pushStep = useCallback(
    (step, value) => {
      setSteps((currentSteps) => {
        if (
          ['insertText', 'moveNativeSelection'].includes(step) &&
          currentSteps.length > 0 &&
          currentSteps[currentSteps.length - 1][0] === step
        ) {
          const newSteps = currentSteps.slice();
          const [lastStep, lastStepValue] = newSteps.pop();
          if (lastStep === 'insertText') {
            newSteps.push(['insertText', lastStepValue.concat(value)]);
          } else {
            newSteps.push([lastStep, value]);
          }
          return newSteps;
        }
        return [...currentSteps, [step, value]];
      });
    },
    [setSteps],
  );

  const onKeyDown = useCallback(
    (event, view) => {
      if (!isRecording) {
        return;
      }
      const maybeCommand = Object.keys(AVAILABLE_INPUTS).find((command) =>
        AVAILABLE_INPUTS[command]?.(event),
      );
      if (maybeCommand != null) {
        if (maybeCommand === 'insertText') {
          pushStep('insertText', event.key);
        } else {
          pushStep(maybeCommand);
        }
        if (['moveBackward', 'moveForward'].includes(maybeCommand)) {
          skipNextSelectionChangeRef.current = true;
        }
      }
    },
    [isRecording, pushStep],
  );

  useOutlineEvent(editor, 'keydown', onKeyDown);

  useEffect(() => {
    const removeUpdateListener = editor.addUpdateListener((viewModel) => {
      const currentSelection = viewModel._selection;
      const previousSelection = previousSelectionRef.current;
      const editorElement = editor.getEditorElement();
      const skipNextSelectionChange = skipNextSelectionChangeRef.current;
      if (previousSelection !== currentSelection) {
        if (
          !viewModel.hasDirtyNodes() &&
          isRecording &&
          !skipNextSelectionChange
        ) {
          const browserSelection = window.getSelection();
          if (
            browserSelection.anchorNode == null ||
            browserSelection.focusNode == null
          ) {
            return;
          }
          const {
            anchorNode,
            anchorOffset,
            focusNode,
            focusOffset,
          } = sanitizeSelectionWithEmptyTextNodes(browserSelection);
          pushStep('moveNativeSelection', [
            `[${getPathFromNodeToEditor(
              anchorNode,
              editorElement,
            ).toString()}]`,
            anchorOffset,
            `[${getPathFromNodeToEditor(focusNode, editorElement).toString()}]`,
            focusOffset,
          ]);
        }
        skipNextSelectionChangeRef.current = false;
        previousSelectionRef.current = currentSelection;
      }
    });
    return removeUpdateListener;
  }, [editor, isRecording, pushStep]);

  useEffect(() => {
    if (!isRecording) {
      return;
    }
    const removeUpdateListener = editor.addUpdateListener((viewModel) => {
      const editorElement = editor.getEditorElement();
      if (editorElement !== null) {
        setCurrentInnerHTML(editorElement?.innerHTML);
      }
    });
    return removeUpdateListener;
  }, [editor, isRecording]);

  const testContent = useMemo(() => {
    const editorElement = editor.getEditorElement();
    const browserSelection = window.getSelection();

    if (
      editorElement == null ||
      browserSelection == null ||
      browserSelection.anchorNode == null ||
      browserSelection.focusNode == null ||
      !editorElement.contains(browserSelection.anchorNode) ||
      !editorElement.contains(browserSelection.focusNode)
    ) {
      return null;
    }

    const processedSteps = [];

    steps.forEach(([action, value]) => {
      processedSteps.push(
        `${action}(${
          value
            ? Array.isArray(value)
              ? value.join(',')
              : typeof value === 'string'
              ? `"${value}"`
              : value
            : ''
        })`,
      );
    });

    const {
      anchorNode,
      anchorOffset,
      focusNode,
      focusOffset,
    } = sanitizeSelectionWithEmptyTextNodes(browserSelection);
    return `
{
  name: '<YOUR TEST NAME>',
  inputs: [
    ${processedSteps.join(',\n    ')}
  ],
  expectedHTML: '<div contenteditable="true" data-outline-editor="true" dir="ltr">${sanitizeHTML(
    currentInnerHTML,
  )}</div>',
  expectedSelection: {
    anchorPath: [${getPathFromNodeToEditor(
      anchorNode,
      editorElement,
    ).toString()}],
    anchorOffset: ${anchorOffset},
    focusPath: [${getPathFromNodeToEditor(
      focusNode,
      editorElement,
    ).toString()}],
    focusOffset: ${focusOffset},
  },
},
    `;
  }, [currentInnerHTML, editor, steps]);

  const toggleEditorSelection = useCallback(
    (currentEditor) => {
      if (!isRecording) {
        currentEditor.update((view: View) => {
          const root = view.getRoot();
          root.clear();
          const text = createTextNode();
          root.append(createParagraphNode().append(text));
          text.select();
        });
        setSteps([]);
      }
      setIsRecording((currentIsRecording) => !currentIsRecording);
    },
    [isRecording],
  );

  useEffect(() => {
    const cb = (event: KeyboardEvent) => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        toggleEditorSelection(getCurrentEditor());
      }
    };
    document.addEventListener('keydown', cb);
    return () => {
      document.removeEventListener('keydown', cb);
    };
  }, [getCurrentEditor, toggleEditorSelection]);

  return createPortal(
    <>
      <button
        id="step-recorder-button"
        onClick={() => toggleEditorSelection(getCurrentEditor())}>
        {isRecording ? 'STOP RECORDING' : 'RECORD TEST'}
      </button>
      {steps.length !== 0 && <pre id="step-recorder">{testContent}</pre>}
    </>,
    document.body,
  );
}