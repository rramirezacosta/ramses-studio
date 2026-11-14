.PHONY: clean linux windows flatpak rpm packages

clean:
	rm -rf dist dist-electron release

appimage:
	npm run package:linux

flatpak:
	npm run package:flatpak

rpm:
	npm run package:rpm

windows:
	npm run package:windows

packages: appimage flatpak rpm windows
