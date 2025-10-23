import { useState } from "react";
import { Button, Input, Heading, Text } from "@medusajs/ui";

interface CreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (title: string) => void;
}

export function CreateModal({ isOpen, onClose, onConfirm }: CreateModalProps) {
  const [title, setTitle] = useState("");

  if (!isOpen) return null;

  const handleConfirm = () => {
    const trimmedTitle = title.trim();
    if (trimmedTitle) {
      onConfirm(trimmedTitle);
      setTitle("");
      onClose();
    } else {
      // Create with default name if empty
      onConfirm("New Conversation");
      setTitle("");
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-ui-bg-base rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
        <Heading level="h2" className="mb-4">
          Create New Conversation
        </Heading>
        <div className="mb-6">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter conversation title (optional)"
            autoFocus
            className="w-full"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleConfirm}>
            Create
          </Button>
        </div>
      </div>
    </div>
  );
}

interface RenameModalProps {
  isOpen: boolean;
  currentTitle: string;
  onClose: () => void;
  onConfirm: (newTitle: string) => void;
}

export function RenameModal({
  isOpen,
  currentTitle,
  onClose,
  onConfirm,
}: RenameModalProps) {
  const [title, setTitle] = useState(currentTitle);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (title.trim()) {
      onConfirm(title.trim());
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-ui-bg-base rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
        <Heading level="h2" className="mb-4">
          Rename Conversation
        </Heading>
        <div className="mb-6">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter conversation title"
            autoFocus
            className="w-full"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleConfirm}
            disabled={!title.trim()}
          >
            Rename
          </Button>
        </div>
      </div>
    </div>
  );
}

interface DeleteModalProps {
  isOpen: boolean;
  conversationTitle: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteModal({
  isOpen,
  conversationTitle,
  onClose,
  onConfirm,
}: DeleteModalProps) {
  if (!isOpen) return null;

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="bg-ui-bg-base rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
        <Heading level="h2" className="mb-4">
          Delete Conversation
        </Heading>
        <Text className="mb-6 text-ui-fg-subtle">
          Are you sure you want to delete "{conversationTitle}"? This action
          cannot be undone.
        </Text>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleConfirm}>
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
