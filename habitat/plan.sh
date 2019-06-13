pkg_name=hubs-discord-bot
pkg_origin=mozillareality
pkg_maintainer="Mozilla Mixed Reality <mixreality@mozilla.com>"
pkg_version="0.0.1"
pkg_license=('MPL2')
pkg_description="Discord bot for Hubs by Mozilla"

pkg_deps=(
  core/coreutils
  core/node/11.2.0
)

pkg_build_deps=(
  core/git
  core/gcc
  core/make
)

do_build() {
  # node-gyp-build has a build script with #!/usr/bin/env
  ln -sv $(pkg_path_for coreutils)/bin/env /usr/bin/env
  npm ci
}

do_install() {
  for dir in node_modules package.json package-lock.json src
  do
    cp -R ./$dir "$pkg_prefix"
  done
}

do_strip() {
  return 0;
}
