package snapshot

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/lock"
	"github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
)

const completeFileName = "complete.txt"
const completeFileContents = "The presence of this file indicates that this snapshot is complete and valid."
const maxNameLength = 250
const nameDisplayCutoffSize = 30

// Manager handles all snapshot-related functionality.
type Manager struct {
	Snapshotter
	paths.Paths
	// The mutex is only included so that `go vet` will throw an error if this struct is ever copied because
	// the Snapshotter contains a pointer back to the Manager, which would not get updated by the copy.
	sync.Mutex
}

func NewManager(p ...paths.Paths) (*Manager, error) {
	var manager Manager
	manager.Snapshotter = NewSnapshotterImpl(&manager)
	if len(p) == 0 {
		var err error
		manager.Paths, err = paths.GetPaths()
		if err != nil {
			return nil, err
		}
	} else {
		manager.Paths = p[0]
	}
	return &manager, nil
}

func (manager *Manager) Snapshot(name string) (Snapshot, error) {
	snapshots, err := manager.List(false)
	if err != nil {
		return Snapshot{}, fmt.Errorf("failed to list snapshots: %w", err)
	}
	for _, candidate := range snapshots {
		if name == candidate.Name {
			return candidate, nil
		}
	}
	return Snapshot{}, fmt.Errorf(`can't find snapshot %q`, name)
}

func (manager *Manager) SnapshotDirectory(snapshot Snapshot) string {
	return filepath.Join(manager.Paths.Snapshots, snapshot.ID)
}

func (manager *Manager) RemoveSnapshotDirectory(snapshot Snapshot) {
	_ = os.RemoveAll(manager.SnapshotDirectory(snapshot))
}

// ValidateName - does syntactic validation on the name
func (manager *Manager) ValidateName(name string) error {
	if len(name) == 0 {
		return fmt.Errorf("snapshot name must not be the empty string")
	}
	reportedName := name
	if len(reportedName) > nameDisplayCutoffSize {
		reportedName = reportedName[0:nameDisplayCutoffSize] + "…"
	}
	if len(name) > maxNameLength {
		return fmt.Errorf(`invalid name %q: max length is %d, %d were specified`, reportedName, maxNameLength, len(name))
	}
	if err := checkForInvalidCharacter(name); err != nil {
		return err
	}
	if unicode.IsSpace(rune(name[0])) {
		return fmt.Errorf(`invalid name %q: must not start with a white-space character`, reportedName)
	}
	if unicode.IsSpace(rune(name[len(name)-1])) {
		if len(name) > nameDisplayCutoffSize {
			reportedName = "…" + name[len(name)-nameDisplayCutoffSize:]
		}
		return fmt.Errorf(`invalid name %q: must not end with a white-space character`, reportedName)
	}
	currentSnapshots, err := manager.List(false)
	if err != nil {
		return fmt.Errorf("failed to list snapshots: %w", err)
	}
	for _, currentSnapshot := range currentSnapshots {
		if currentSnapshot.Name == name {
			return fmt.Errorf("name %q already exists", name)
		}
	}
	return nil
}

func (manager *Manager) WriteMetadataFile(snapshot Snapshot) (err error) {
	snapshotDir := manager.SnapshotDirectory(snapshot)
	if err = os.MkdirAll(snapshotDir, 0o755); err != nil {
		return fmt.Errorf("failed to create snapshot directory: %w", err)
	}
	metadataPath := filepath.Join(snapshotDir, "metadata.json")
	metadataFile, err := os.Create(metadataPath)
	if err != nil {
		return fmt.Errorf("failed to create metadata file: %w", err)
	}
	defer metadataFile.Close()
	encoder := json.NewEncoder(metadataFile)
	encoder.SetIndent("", "  ")
	if err = encoder.Encode(snapshot); err != nil {
		return fmt.Errorf("failed to write metadata file: %w", err)
	}
	return
}

// Create a new snapshot.
func (manager *Manager) Create(name, description string) (snapshot Snapshot, err error) {
	// Report on invalid names before locking and shutting down the backend
	if err = manager.ValidateName(name); err != nil {
		return
	}
	id, err := uuid.NewRandom()
	if err != nil {
		return snapshot, fmt.Errorf("failed to generate ID for snapshot: %w", err)
	}
	snapshot = Snapshot{
		Created:     time.Now(),
		Name:        name,
		ID:          id.String(),
		Description: description,
	}
	if err = lock.Lock(manager.Paths, "create"); err != nil {
		return
	}
	defer func() {
		if err != nil {
			manager.RemoveSnapshotDirectory(snapshot)
		}
		_ = lock.Unlock(manager.Paths, true)
	}()
	// Revalidate the name in case another process created a snapshot with the same name in the gap
	// between our first validation and creating the lock file.
	if err = manager.ValidateName(name); err != nil {
		return
	}
	if err = manager.WriteMetadataFile(snapshot); err == nil {
		err = manager.CreateFiles(snapshot)
	}
	return
}

// List snapshots that are present on the system. If includeIncomplete is
// true, includes snapshots that are currently being created, are currently
// being deleted, or are otherwise incomplete and cannot be restored from.
func (manager *Manager) List(includeIncomplete bool) ([]Snapshot, error) {
	dirEntries, err := os.ReadDir(manager.Paths.Snapshots)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return []Snapshot{}, fmt.Errorf("failed to read snapshots directory: %w", err)
	}
	snapshots := make([]Snapshot, 0, len(dirEntries))
	for _, dirEntry := range dirEntries {
		if _, err := uuid.Parse(dirEntry.Name()); err != nil {
			continue
		}
		snapshot := Snapshot{}
		metadataPath := filepath.Join(manager.Paths.Snapshots, dirEntry.Name(), "metadata.json")
		contents, err := os.ReadFile(metadataPath)
		if err != nil {
			return []Snapshot{}, fmt.Errorf("failed to read %q: %w", metadataPath, err)
		}
		if err := json.Unmarshal(contents, &snapshot); err != nil {
			return []Snapshot{}, fmt.Errorf("failed to unmarshal contents of %q: %w", metadataPath, err)
		}
		// TODO this should be done by the caller
		snapshot.Created = snapshot.Created.Local()

		completeFilePath := filepath.Join(manager.Paths.Snapshots, snapshot.ID, completeFileName)
		_, err = os.Stat(completeFilePath)
		completeFileExists := err == nil

		if !includeIncomplete && !completeFileExists {
			continue
		}

		snapshots = append(snapshots, snapshot)
	}
	return snapshots, nil
}

// Delete a snapshot.
func (manager *Manager) Delete(name string) error {
	snapshot, err := manager.Snapshot(name)
	if err != nil {
		return err
	}
	snapshotDir := manager.SnapshotDirectory(snapshot)
	// Remove complete.txt file. This must be done first because restoring
	// from a partially-deleted snapshot could result in errors.
	err = os.RemoveAll(filepath.Join(snapshotDir, completeFileName))
	return errors.Join(err, os.RemoveAll(snapshotDir))
}

// Restore Rancher Desktop to the state saved in a snapshot.
func (manager *Manager) Restore(name string) (err error) {
	snapshot, err := manager.Snapshot(name)
	if err != nil {
		return err
	}

	if err := lock.Lock(manager.Paths, "restore"); err != nil {
		return err
	}
	defer func() {
		// Don't restart the backend if the restore failed
		_ = lock.Unlock(manager.Paths, err == nil)
	}()
	if err = manager.RestoreFiles(snapshot); err != nil {
		return fmt.Errorf("failed to restore files: %w", err)
	}

	return nil
}

func checkForInvalidCharacter(name string) error {
	for idx, c := range name {
		if !unicode.IsPrint(c) {
			return fmt.Errorf("invalid character value %d at position %d in name: all characters must be printable or a space", c, idx)
		}
	}
	return nil
}
