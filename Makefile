.PHONY: linux windows packages

linux:
	npm run package:linux

windows:
	npm run package:windows

packages: linux windows
