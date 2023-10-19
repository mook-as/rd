//go:build unix

package snapshot

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	p "github.com/rancher-sandbox/rancher-desktop/src/go/rdctl/pkg/paths"
)

func populateFiles(t *testing.T, includeOverrideYaml bool) (p.Paths, map[string]TestFile) {
	baseDir := t.TempDir()
	paths := p.Paths{
		Config:    filepath.Join(baseDir, "config"),
		Lima:      filepath.Join(baseDir, "lima"),
		Snapshots: filepath.Join(baseDir, "snapshots"),
	}
	testFiles := map[string]TestFile{
		"settings.json": {
			Path:     filepath.Join(paths.Config, "settings.json"),
			Contents: `{"test": "settings.json"}`,
		},
		"basedisk": {
			Path:     filepath.Join(paths.Lima, "0", "basedisk"),
			Contents: "basedisk contents",
		},
		"diffdisk": {
			Path:     filepath.Join(paths.Lima, "0", "diffdisk"),
			Contents: "diffdisk contents",
		},
		"user": {
			Path:     filepath.Join(paths.Lima, "_config", "user"),
			Contents: "user SSH key",
		},
		"user.pub": {
			Path:     filepath.Join(paths.Lima, "_config", "user.pub"),
			Contents: "user public SSH key",
		},
		"lima.yaml": {
			Path:     filepath.Join(paths.Lima, "0", "lima.yaml"),
			Contents: "this is yaml",
		},
	}
	if includeOverrideYaml {
		testFiles["override.yaml"] = TestFile{
			Path:     filepath.Join(paths.Lima, "_config", "override.yaml"),
			Contents: "test: override.yaml",
		}
	}
	for _, file := range testFiles {
		testDirectory := filepath.Dir(file.Path)
		if err := os.MkdirAll(testDirectory, 0o755); err != nil {
			t.Fatalf("failed to create dir %q: %s", testDirectory, err)
		}
		if err := os.WriteFile(file.Path, []byte(file.Contents), 0o644); err != nil {
			t.Fatalf("failed to create test file %q: %s", file.Path, err)
		}
	}
	return paths, testFiles
}

func newTestManager(paths p.Paths) Manager {
	return NewManager(paths)
}

func TestManagerUnix(t *testing.T) {
	for _, includeOverrideYaml := range []bool{true, false} {
		t.Run(fmt.Sprintf("Create with includeOverrideYaml %t", includeOverrideYaml), func(t *testing.T) {
			paths, _ := populateFiles(t, includeOverrideYaml)

			// create snapshot
			testManager := newTestManager(paths)
			snapshot, err := testManager.Create("test-snapshot", "")
			if err != nil {
				t.Fatalf("unexpected error creating snapshot: %s", err)
			}

			// ensure desired files are present
			snapshotFiles := []string{
				filepath.Join(paths.Snapshots, snapshot.ID, "settings.json"),
				filepath.Join(paths.Snapshots, snapshot.ID, "basedisk"),
				filepath.Join(paths.Snapshots, snapshot.ID, "diffdisk"),
				filepath.Join(paths.Snapshots, snapshot.ID, "metadata.json"),
			}
			if includeOverrideYaml {
				snapshotFiles = append(snapshotFiles, filepath.Join(paths.Snapshots, snapshot.ID, "override.yaml"))
			}
			for _, file := range snapshotFiles {
				if _, err := os.ReadFile(file); err != nil {
					t.Errorf("file %q does not exist in snapshot: %s", file, err)
				}
			}
		})
	}

	for _, includeOverrideYaml := range []bool{true, false} {
		t.Run(fmt.Sprintf("Restore with includeOverrideYaml %t", includeOverrideYaml), func(t *testing.T) {
			paths, testFiles := populateFiles(t, includeOverrideYaml)
			manager := newTestManager(paths)
			snapshot, err := manager.Create("test-snapshot", "")
			if err != nil {
				t.Fatalf("failed to create snapshot: %s", err)
			}
			for testFileName, testFile := range testFiles {
				if err := os.WriteFile(testFile.Path, []byte(`{"something": "different"}`), 0o644); err != nil {
					t.Fatalf("failed to modify %s: %s", testFileName, err)
				}
			}
			if err := manager.Restore(snapshot.ID); err != nil {
				t.Fatalf("failed to restore snapshot: %s", err)
			}
			for testFileName, testFile := range testFiles {
				contents, err := os.ReadFile(testFile.Path)
				if err != nil {
					t.Fatalf("failed to read contents of %s: %s", testFileName, err)
				}
				if string(contents) != testFile.Contents {
					t.Errorf("contents of %s appear to have not been restored", testFileName)
				}
			}
		})
	}

	t.Run("Restore should delete override.yaml if restoring to a snapshot without it", func(t *testing.T) {
		paths, testFiles := populateFiles(t, true)
		manager := newTestManager(paths)
		if err := os.Remove(testFiles["override.yaml"].Path); err != nil {
			t.Fatalf("failed to delete override.yaml: %s", err)
		}
		snapshot, err := manager.Create("test-snapshot", "")
		if err != nil {
			t.Fatalf("failed to create snapshot: %s", err)
		}
		for testFileName, testFile := range testFiles {
			if err := os.WriteFile(testFile.Path, []byte(`{"something": "different"}`), 0o644); err != nil {
				t.Fatalf("failed to modify %s: %s", testFileName, err)
			}
		}
		if err := manager.Restore(snapshot.ID); err != nil {
			t.Fatalf("failed to restore snapshot: %s", err)
		}
		overrideYamlPath := testFiles["override.yaml"].Path
		delete(testFiles, "override.yaml")
		for testFileName, testFile := range testFiles {
			contents, err := os.ReadFile(testFile.Path)
			if err != nil {
				t.Fatalf("failed to read contents of %s: %s", testFileName, err)
			}
			if string(contents) != testFile.Contents {
				t.Errorf("contents of %s appear to have not been restored", testFileName)
			}
		}
		if _, err := os.Stat(overrideYamlPath); !errors.Is(err, os.ErrNotExist) {
			t.Errorf("override.yaml appears to not have been removed in restore")
		}
	})

	t.Run("Restore should create any needed parent directories", func(t *testing.T) {
		paths, _ := populateFiles(t, true)
		manager := newTestManager(paths)
		snapshot, err := manager.Create("test-snapshot", "")
		if err != nil {
			t.Fatalf("failed to create snapshot: %s", err)
		}
		for _, dir := range []string{paths.Config, paths.Lima} {
			if err := os.RemoveAll(dir); err != nil {
				t.Fatalf("failed to remove directory: %s", err)
			}
		}
		if err := manager.Restore(snapshot.ID); err != nil {
			t.Fatalf("failed to restore snapshot: %s", err)
		}
	})
}
