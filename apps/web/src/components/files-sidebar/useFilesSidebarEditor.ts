import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

import { projectQueryKeys, projectReadFileQueryOptions } from '../../lib/projectReactQuery'
import { getWsRpcClient } from '../../wsRpcClient'
import { toastManager } from '../ui/toastState'

interface FilesEditorState {
  path: string | null
  baseline: string
  draft: string
}

function confirmDiscardChanges(): boolean {
  return window.confirm('Discard unsaved file changes?')
}

function useWorkspaceEditorState(input: { cwd: string; selectedFilePath: string | null }) {
  const [editorState, setEditorState] = useState<FilesEditorState>({
    path: null,
    baseline: '',
    draft: '',
  })
  const fileQuery = useQuery(
    projectReadFileQueryOptions({
      cwd: input.cwd,
      relativePath: input.selectedFilePath,
      enabled: input.selectedFilePath !== null,
    })
  )
  const isDirty =
    editorState.path !== null &&
    editorState.path === input.selectedFilePath &&
    editorState.draft !== editorState.baseline

  useEffect(() => {
    const nextFile = fileQuery.data
    if (!nextFile || nextFile.relativePath !== input.selectedFilePath) return
    setEditorState(current => {
      if (current.path === nextFile.relativePath && current.draft !== current.baseline) {
        return current
      }
      return {
        path: nextFile.relativePath,
        baseline: nextFile.contents,
        draft: nextFile.contents,
      }
    })
  }, [fileQuery.data, input.selectedFilePath])

  return { editorState, fileQuery, isDirty, setEditorState }
}

function useWorkspaceFileSave(input: {
  cwd: string
  selectedFilePath: string | null
  editorState: FilesEditorState
  isDirty: boolean
  setEditorState: Dispatch<SetStateAction<FilesEditorState>>
}) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async (next: { cwd: string; relativePath: string; contents: string }) =>
      getWsRpcClient().projects.writeFile(next),
  })

  const handleSave = () => {
    if (!input.selectedFilePath || !input.isDirty || mutation.isPending) return
    const nextContents = input.editorState.draft
    void mutation
      .mutateAsync({
        cwd: input.cwd,
        relativePath: input.selectedFilePath,
        contents: nextContents,
      })
      .then(() => {
        input.setEditorState(current =>
          current.path === input.selectedFilePath
            ? { ...current, baseline: nextContents, draft: nextContents }
            : current
        )
        queryClient.setQueryData(projectQueryKeys.readFile(input.cwd, input.selectedFilePath), {
          relativePath: input.selectedFilePath,
          contents: nextContents,
        })
        toastManager.add({
          type: 'success',
          title: 'File saved',
          description: input.selectedFilePath,
        })
      })
      .catch(error => {
        toastManager.add({
          type: 'error',
          title: 'Could not save file',
          description: error instanceof Error ? error.message : 'Save failed.',
        })
      })
  }

  return { handleSave, saveFileMutation: mutation }
}

export function useFilesSidebarEditor(props: { cwd: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const { editorState, fileQuery, isDirty, setEditorState } = useWorkspaceEditorState({
    cwd: props.cwd,
    selectedFilePath,
  })
  const { handleSave, saveFileMutation } = useWorkspaceFileSave({
    cwd: props.cwd,
    selectedFilePath,
    editorState,
    isDirty,
    setEditorState,
  })

  const handleOpenFile = (path: string) => {
    if (path === selectedFilePath) return
    if (isDirty && !confirmDiscardChanges()) return
    setSelectedFilePath(path)
  }

  const handleClose = () => {
    if (isDirty && !confirmDiscardChanges()) return
    props.onClose()
  }

  const handleRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: projectQueryKeys.listEntries(props.cwd) })
    if (!selectedFilePath) return
    void queryClient.invalidateQueries({
      queryKey: projectQueryKeys.readFile(props.cwd, selectedFilePath),
    })
  }

  return {
    contents: editorState.path === selectedFilePath ? editorState.draft : '',
    errorMessage: fileQuery.isError
      ? fileQuery.error instanceof Error
        ? fileQuery.error.message
        : 'Could not open file.'
      : null,
    handleChange: (draft: string) =>
      setEditorState(current =>
        current.path === selectedFilePath ? { ...current, draft } : current
      ),
    handleClose,
    handleOpenFile,
    handleRefresh,
    handleSave,
    isDirty,
    isLoading: fileQuery.isLoading,
    isRefreshing: fileQuery.isFetching || saveFileMutation.isPending,
    isSaving: saveFileMutation.isPending,
    selectedFilePath,
  }
}
