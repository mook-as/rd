/*
Copyright © 2024 SUSE LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

	http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package integration

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"slices"

	"github.com/sirupsen/logrus"
)

const (
	dirsKey = "cliPluginsExtraDirs"
)

// SetupPluginDirConfig configures docker CLI to load plugins from the directory
// given.
func SetupPluginDirConfig(homeDir, pluginPath string, enabled bool) error {
	configPath := filepath.Join(homeDir, ".docker", "config.json")
	config := make(map[string]any)

	configBytes, err := os.ReadFile(configPath)
	if errors.Is(err, os.ErrNotExist) {
		// If the config file does not exist, start with empty map.
		if !enabled {
			return nil
		}
	} else if err != nil {
		return fmt.Errorf("could not read docker CLI configuration: %w", err)
	} else {
		if err = json.Unmarshal(configBytes, &config); err != nil {
			return fmt.Errorf("could not parse docker CLI configuration: %w", err)
		}
	}

	var dirs []string

	if dirsRaw, ok := config[dirsKey]; ok {
		if dirsAny, ok := dirsRaw.([]any); ok {
			for _, item := range dirsAny {
				if dir, ok := item.(string); ok {
					dirs = append(dirs, dir)
				} else {
					return fmt.Errorf("failed to update docker CLI configuration: %q has non-string item %v", dirsKey, item)
				}
			}
		} else {
			return fmt.Errorf("failed to update docker CLI configuration: %q is not a string array", dirsKey)
		}
		index := slices.Index(dirs, pluginPath)
		if enabled {
			if index >= 0 {
				// Config file already contains the plugin path; nothing to do.
				return nil
			}
			dirs = append(dirs, pluginPath)
		} else {
			if index < 0 {
				// Config does not contain the plugin path; nothing to do.
				return nil
			}
			dirs = slices.Delete(dirs, index, index+1)
		}
	} else {
		if !enabled {
			// The key does not exist, and we don't want it; nothing to do.
			return nil
		}
		// The key does not exist; add it.
		dirs = []string{pluginPath}
	}
	if len(dirs) > 0 {
		config[dirsKey] = dirs
	} else {
		delete(config, dirsKey)
	}

	if configBytes, err = json.Marshal(config); err != nil {
		return fmt.Errorf("failed to serialize updated docker CLI configuration: %w", err)
	}

	if err = os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		return fmt.Errorf("failed to update docker CLI configuration: could not create parent: %w", err)
	}

	if err = os.WriteFile(configPath, configBytes, 0o644); err != nil {
		return fmt.Errorf("failed to update docker CLI configuration: %w", err)
	}

	return nil
}

// RemoveObsoletePluginSymlinks removes symlinks in the docker CLI plugin
// directory which are children of the given directory.
func RemoveObsoletePluginSymlinks(homeDir, binPath string) error {
	pluginDir := path.Join(homeDir, ".docker", "cli-plugins")
	entries, err := os.ReadDir(pluginDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			// If the plugin directory does not exist, there is nothing to do.
			logrus.Debugf("Docker CLI plugins directory %q does not exist", pluginDir)
			return nil
		}
		return fmt.Errorf("failed to enumerate docker CLI plugins: %w", err)
	}
	for _, entry := range entries {
		if entry.Type()&os.ModeSymlink != os.ModeSymlink {
			// entry is not a symlink; ignore it.
			logrus.Debugf("Plugin %q is not a symlink", entry.Name())
			continue
		}
		entryPath := path.Join(pluginDir, entry.Name())
		target, err := os.Readlink(entryPath)
		if err != nil {
			logrus.Debugf("Error reading plugin symlink %q: %v", entryPath, err)
		} else if filepath.Dir(target) == binPath {
			// Remove the symlink, ignoring any errors.
			_ = os.Remove(entryPath)
		} else {
			logrus.Debugf("Plugin symlink %q does not start with %q", target, binPath)
		}
	}

	return nil
}
