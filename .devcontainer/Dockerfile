# The Skills Network Cloud IDE uses Ubuntu 18.04 :(
    FROM ubuntu:22.04

    ENV DEBIAN_FRONTEND=noninteractive

    RUN apt-get update && \
        apt-get install -y software-properties-common dirmngr apt-transport-https lsb-release ca-certificates && \
        add-apt-repository -y ppa:deadsnakes/ppa

    # Add any tools that are needed
    RUN apt update && \
        apt install -y sudo \
            vim \
            make \
            git \
            zip \
            tree \
            curl \
            wget \
            jq \
            dnsutils\
            python3.11-dev python3-pip && \
            update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 && \
            apt-get autoremove -y && \
            apt-get clean -y

    
    # Create a user for development
    ARG USERNAME=Yas
    ARG USER_UID=1000
    ARG USER_GID=$USER_UID
    
    # Create the user with passwordless sudo privileges
    RUN groupadd --gid $USER_GID $USERNAME \
        && useradd --uid $USER_UID --gid $USER_GID -m $USERNAME -s /bin/bash \
        && usermod -aG sudo $USERNAME \
        && echo $USERNAME ALL=\(root\) NOPASSWD:ALL > /etc/sudoers.d/$USERNAME \
        && chmod 0440 /etc/sudoers.d/$USERNAME
    
    # Set up the Python development environment
    WORKDIR /home/project
    RUN python3 -m pip install --upgrade pip && \
        pip3 install --upgrade wheel 
 
    ENV PORT 8000
    EXPOSE $PORT
    
    # Enable color terminal for docker exec bash
    ENV TERM=xterm-256color
    
    # Become a regular user
    USER $USERNAME
    