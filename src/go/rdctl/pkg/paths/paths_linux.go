package paths

import (
	"errors"
	"fmt"
	"os"
	"path"
)

func GetPaths(getResourcesPathFuncs ...func() (string, error)) (*Paths, error) {
	var getResourcesPathFunc func() (string, error)
	switch len(getResourcesPathFuncs) {
	case 0:
		getResourcesPathFunc = getResourcesPath
	case 1:
		getResourcesPathFunc = getResourcesPathFuncs[0]
	default:
		return nil, errors.New("you can only pass one function in getResourcesPathFuncs arg")
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("failed to get user home directory: %w", err)
	}
	dataHome := os.Getenv("XDG_DATA_HOME")
	if dataHome == "" {
		dataHome = path.Join(homeDir, ".local", "share")
	}
	configHome := os.Getenv("XDG_CONFIG_HOME")
	if configHome == "" {
		configHome = path.Join(homeDir, ".config")
	}
	cacheHome := os.Getenv("XDG_CACHE_HOME")
	if cacheHome == "" {
		cacheHome = path.Join(homeDir, ".cache")
	}
	altAppHome := path.Join(homeDir, ".rd")
	paths := Paths{
		AppHome:                 path.Join(dataHome, appName),
		AltAppHome:              altAppHome,
		Config:                  path.Join(configHome, appName),
		Cache:                   path.Join(cacheHome, appName),
		Lima:                    path.Join(dataHome, appName, "lima"),
		Integration:             path.Join(altAppHome, "bin"),
		DeploymentProfileSystem: path.Join("/etc", appName),
		DeploymentProfileUser:   configHome,
		ExtensionRoot:           path.Join(dataHome, appName, "extensions"),
		Snapshots:               path.Join(dataHome, appName, "snapshots"),
		ContainerdShims:         path.Join(dataHome, appName, "containerd-shims"),
	}
	paths.Logs = os.Getenv("RD_LOGS_DIR")
	if paths.Logs == "" {
		paths.Logs = path.Join(dataHome, appName, "logs")
	}
	paths.Resources, err = getResourcesPathFunc()
	if err != nil {
		return nil, fmt.Errorf("failed to find resources directory: %w", err)
	}

	return &paths, nil
}
