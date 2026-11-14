.PHONY: clean linux windows win-installer flatpak rpm packages

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

win-installer:
	npm run package:win-installer

packages: appimage flatpak rpm windows win-installer
