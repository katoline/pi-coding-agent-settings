{
  description = "Pi harness development tools";
  inputs.nixpkgs.url = "tarball+https://codeload.github.com/NixOS/nixpkgs/tar.gz/09063bd1f2b36fd9fd793c36dfade7bd40a93dfc";
  outputs = { nixpkgs, ... }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      eachSystem = nixpkgs.lib.genAttrs systems;
    in {
      devShells = eachSystem (system:
        let pkgs = import nixpkgs { inherit system; };
        in { default = pkgs.mkShell {
          packages = with pkgs; [ nodejs_24 git gh ];
          shellHook = ''
            export npm_config_cache="$PWD/.harness/npm-cache"
            echo "Node, Git and gh are ready. Use the project lockfile with npm ci."
          '';
        }; });
    };
}
